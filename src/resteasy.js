var Router = require('koa-router');
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

  console.error('RESTEASY: ' + JSON.stringify(resteasy) + '.');

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

function Resteasy(knex, options) {
  // prepare the environment

  options = options || {};
  options.tableBlacklist = _.union(options.tableBlacklist || [], [/^pg_.*$/, /^information_schema\..*$/]);

  var router = new Router();

  router.use(function *(next) {
    this.resteasy = { options: options };
    this.resteasy.knex = knex;
    yield next;
  });

  router.use(prepare);

  if (options.table) {
    router.post('/', create);
    router.put('/:id', update);
    router.patch('/:id', update);
    router.get('/', index);
    router.get('/:id', read);
    router.delete('/:id', destroy);
  } else {
    router.post('/:table', create);
    router.put('/:table/:id', update);
    router.patch('/:table/:id', update);
    router.get('/:table', index);
    router.get('/:table/:id', read);
    router.delete('/:table/:id', destroy);
  }

  return router.routes();
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
