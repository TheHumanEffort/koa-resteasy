var queries = require('./queries');
var Schema = require('./schema');
var co = require('co');
var _ = require('lodash');

// get and sanitize table:
function table(context) {
  return context.params.table.replace(/[^a-zA-Z\._\-]/g, '');
}

function count(query, ctx) {
  return query.count('*');
}

// calculate implied fields, e.g: api/users/4/playlists means the
// playlist has a user_id = 4 (based on the foreign keys in the DB).

function impliedHash(ctx) {
  var constraints = ctx.resteasy.constraints;
  var context = ctx.params.context;
  var table = ctx.resteasy.table;
  var hash = {};

  if (context) {
    _.each(constraints, function(constraint) {
      var contextTable = getTable(context);
      var contextId = getId(context);

      console.error(constraint.table_name, table, constraint.foreign_table_name, contextTable);
      if (constraint.table_name == table && constraint.foreign_table_name == contextTable) {
        hash[constraint.column_name] = contextId;
      }
    });
  }

  return hash;
}

function applyContext(query) {
  // simple hash assumption logic:
  // api/users/4/playlists is playlists where user_id = 4
  var hash = impliedHash(this);
  return queries.whereFromHash(query, hash);
}

function *prepare(next) {
  var _this = this;
  var ctx = _this;
  var resteasy = this.resteasy;

  resteasy.table = (resteasy.options && resteasy.options.table) || table(this);
  if (resteasy.options.tableBlacklist) {
    if (_.find(resteasy.options.tableBlacklist, function(re) { return resteasy.table.match(re); })) {

      throw new Error('Disallowed Table');
    }
  }

  yield resteasy.knex.transaction(function(trx) {
    resteasy.transaction = trx;
    resteasy.query = trx(resteasy.table);
    resteasy.queries = [];

    return co(function *() {
      var constraints = resteasy.constraints = yield resteasy.schema.constraints(resteasy.table);

      var q;
      if (resteasy.options.applyContext) {
        q = resteasy.options.applyContext.call(ctx, resteasy.query);
      }

      if (q) {
        resteasy.query = q;
      } else {
        resteasy.query = applyContext.call(ctx, resteasy.query);
      }

      resteasy.query.on('query-response', function(rows, res, builder) {
        resteasy.pgRes = res;
      });

      yield next;

      // only execute the query if the behavior is default:
      if (resteasy.query) {
        var sql = yield resteasy.query.toSQL();

        var res = yield resteasy.query;

        yield hook(ctx, 'afterQuery', res);

        if (resteasy.queries) {
          var multires = yield resteasy.queries;
          console.log(multires);
        }

        if (resteasy.isCollection)
          ctx.body = res;
        else
          ctx.body = res[0];
      }
    });
  });
}

const IGNORED_QUERIES = ['fields', 'order', 'limit', 'offset'];

// hook calls look like:
//
// hooks: {
//   beforeSave: [ function*(...args) ]
// }
//

function *hook(ctx, hookName/*, ... args */) {
  var allHooks = ctx.resteasy.options.hooks;
  if (!allHooks) {
    console.error('No hooks.');
    return;
  }

  var scopedHooks = allHooks[hookName];
  if (!scopedHooks) {
    console.error('No scoped hooks.' + hookName);
    return;
  }

  var args = Array.prototype.slice.call(arguments, 2);

  if (typeof scopedHooks == 'function')
    scopedHooks = [scopedHooks];

  console.error(` ${scopedHooks.length} scoped hooks`);
  for (var i = 0; i < scopedHooks.length; i++) {
    yield scopedHooks[i].apply(ctx, args);
  }
}

function *index(next) {
  // drop ignored queries:
  var hash = _.clone(this.query);

  _.each(IGNORED_QUERIES, function(ignored) { delete hash[ignored]; });

  var query = queries.whereFromHash(this.resteasy.query, hash);

  // if we have limit/offset, we probably want an unadulterated count:
  if (this.query.limit || this.query.offset)
    this.resteasy.count = (yield count(query.clone(), this))[0].count;

  // now we apply order, windowing, and pick what items we want returned:
  queries.order(query, this.query.order);
  queries.window(query, this.query.offset, this.query.limit);
  queries.select(query, this.query.fields, this.resteasy.table);

  this.resteasy.isCollection = true;

  yield hook(this, 'authorize', 'read', this.query);

  yield next;
}

function *create(next) {
  // add values implied by the route (e.g. api/users/3/playlists)
  var implied = impliedHash(this);

  var hash = this.resteasy.object = _.extend({}, implied, this.body);

  var columns = (yield this.resteasy.schema.columns(this.resteasy.table));
  if (_.find(columns, { column_name: 'updated_at' })) {
    hash['updated_at'] = this.resteasy.knex.fn.now();
  }

  if (_.find(columns, { column_name: 'created_at' })) {
    hash['created_at'] = this.resteasy.knex.fn.now();
  }

  yield hook(this, 'beforeSave');
  yield hook(this, 'authorize', 'create', hash);

  queries.create(this.resteasy.query, hash);

  yield next;
}

function *read(next) {
  yield hook(this, 'authorize', 'read', this.params.id);
  queries.read(this.resteasy.query, this.params.id, this.resteasy.table);

  yield next;
}

function *update(next) {
  var hash = this.resteasy.object = this.body;

  var columns = (yield this.resteasy.schema.columns(this.resteasy.table));
  if (_.find(columns, { column_name: 'updated_at' })) {
    hash['updated_at'] = this.resteasy.knex.fn.now();
  }

  yield hook(this, 'beforeSave');
  yield hook(this, 'authorize', 'update', this.params.id);

  queries.update(this.resteasy.query, this.params.id, this.resteasy.object);

  yield next;
}

// destroy is special - it does the query itself, as it is unusual in
// how it creates a response - the object isn't returned.
function *destroy(next) {
  queries.destroy(this.resteasy.query, this.params.id);

  yield next;

  var res = yield this.resteasy.query;
  delete this.resteasy.query;

  this.body = { success: !!res };
}

const HAS_ID_RE = /\/(\d+)$/;
const TABLE_RE = /\/?([^\/]+?)\/?(?:(\d+))?$/;

const CONTEXT_RE = /^\/(?:api\/)?(?:v\d+\/)?(.*?)\/([^\/]+?)\/?(?:(\d+))?$/;

function getId(path) {
  var m = path.match(HAS_ID_RE);
  if (m) return m[1];
  return null;
}

function getTable(path) {
  var m = path.match(TABLE_RE);
  if (m) return m[1];
  return null;
}

function getContext(path) {
  var m = path.match(CONTEXT_RE);
  if (m) return m[1];
  return null;
}

function Resteasy(knex, options) {
  options = options || {};
  options.tableBlacklist = _.union(options.tableBlacklist || [], [/^pg_.*$/, /^information_schema\..*$/]);

  var schema = Schema(knex);

  // smart 'router' function, that determines what the intended action
  // is, and what can be done in order to prepare for and execute this
  // action:
  //
  // It looks at method and path in order to best determine what needs
  // to happen.  In the future, it may additionally look at
  // relationships so that you can have more literate URLs like:
  //
  // /users/6/playlists?order=+modified_at
  //
  // GET /:table or GET / -> index
  // POST /:table or POST / -> create
  // GET /:table/:id or GET /:id -> read
  // PUT or PATCH /:table/:id or /:id -> update
  // DELETE /:table/:id or /:id -> destroy
  //

  return function*(next) {
    var id = getId(this.path);
    var table = getTable(this.path);
    var context = getContext(this.path);

    this.params = { id, table, context };

    var operation = null;

    switch (this.method) {
    case 'GET':
      if (id) operation = read;
      else operation = index;

      break;
    case 'POST':
    case 'PUT':
    case 'PATCH':
      if (id) operation = update;
      else operation = create;

      break;
    case 'DELETE':
      if (id) operation = destroy;

      break;
    }

    // if it's a valid operaiton, perform it:
    if (operation) {
      this.resteasy = { options: options };
      this.resteasy.operation = operation.name;
      this.resteasy.knex = knex;
      this.resteasy.schema = schema;

      yield prepare.call(this, operation.call(this, next));
    } else {
      // if it is not, just pass on through:
      yield next;
    }
  };
};

module.exports = function(knex, options) {
  if (options) {
    return Resteasy(knex, options);
  } else {
    return function(options) {
      return Resteasy(knex, options);
    };
  }
};
