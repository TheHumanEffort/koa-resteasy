var queries = require('./queries');
var _ = require('lodash');

// get and sanitize table:
function table(context) {
  return context.params.table.replace(/[^a-zA-Z\._\-]/g, '');
}

function count(query, ctx) {
  return query.count('*');
}

function *prepare(next) {
  var resteasy = this.resteasy;

  resteasy.table = (resteasy.options && resteasy.options.table) || table(this);
  if (resteasy.options.tableBlacklist) {
    if (_.find(resteasy.options.tableBlacklist, function(re) { return resteasy.table.match(re); })) {

      throw new Error('Disallowed Table');
    }
  }

  resteasy.query = resteasy.knex(resteasy.table);

  resteasy.query.on('query-response', function(rows, res, builder) {
    resteasy.pgRes = res;
  });

  yield next;

  // only execute the query if the behavior is default:
  if (resteasy.query) {
    var res = yield resteasy.query;

    if (resteasy.isCollection)
      this.body = { result: res, meta: { count: resteasy.count, pg: resteasy.pgRes } };
    else
      this.body = { result: res[0], meta: {  pg: resteasy.pgRes } };
  }
}

const IGNORED_QUERIES = ['fields', 'order', 'limit', 'offset'];

function *index(next) {
  // drop ignored queries:
  var hash = _.reject(this.query, function(value, key) { return _.includes(IGNORED_QUERIES, key); });

  var query = queries.whereFromHash(this.resteasy.query, hash);

  // if we have limit/offset, we probably want an unadulterated count:
  if (this.query.limit || this.query.offset)
    this.resteasy.count = (yield count(query.clone(), this))[0].count;

  // now we apply order, windowing, and pick what items we want returned:
  queries.order(query, this.query.order);
  queries.window(query, this.query.offset, this.query.limit);
  queries.select(query, this.query.fields, this.resteasy.table);

  this.resteasy.isCollection = true;

  yield next;
}

function *create(next) {
  query.create(this.resteasy.query, this.request.body);

  yield next;
}

function *read(next) {
  console.error('READING');
  queries.read(this.resteasy.query, this.params.id, this.resteasy.table);

  yield next;
}

function *update(next) {
  queries.update(this.resteasy.query, this.params.id, this.request.body);

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
const TABLE_RE = /\/([^\/]+?)\/?(?:(\d+))?$/;

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

function Resteasy(knex, options) {
  options = options || {};
  options.tableBlacklist = _.union(options.tableBlacklist || [], [/^pg_.*$/, /^information_schema\..*$/]);

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

    console.error('path: ', this.path);
    console.error('Id: ', id);
    console.error('Table: ', table);

    this.params = { id, table };

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
      this.resteasy.knex = knex;

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
