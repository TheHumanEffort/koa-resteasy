# koa-resteasy
REST endpoint middleware for Koa &amp; Knex, currently only supports Koa 1 and Postgres.

## Usage

```
npm install --save koa-resteasy
```

### TODO:

- has-and-belongs-to-many/join table support (e.g. /api/playlists/5/tracks)

### Example:
```
var app = require('koa')();
var body = require('koa-better-body');
var mount = require('koa-mount');
var helmet = require('koa-helmet');
var pg = require('koa-pg');
var _ = require('lodash');

var Router = require('koa-router');
var router = new Router();
var preRouter = new Router();

var knex = require('knex')({ client: 'pg',
                             connection: {
                               host: 'postgres',
                               user: process.env.POSTGRES_ENV_POSTGRES_USER,
                               password: process.env.POSTGRES_ENV_POSTGRES_PASSWORD,
                               database: 'koa-rest-development',
                               port: '5432',
                             },
                           });

var Resteasy = require('koa-resteasy')(knex);

var pgUser = process.env.POSTGRES_ENV_POSTGRES_USER;
var pgPass = process.env.POSTGRES_ENV_POSTGRES_PASSWORD;
var dbName = process.env.DATABASE_NAME + '-' + app.env;
var postgresUrl = (process.env.POSTGRES_URL || 'postgres://' + pgUser + ':' + pgPass + '@postgres:5432/' + dbName);

// omitting table option makes it a generic instance:

// adding the table thing, collapses the RESTEasy instance to just one
// table:
var reviewsRest = Resteasy({ table: 'reviews' });

// and you can add routes taht leverage the REST middleware: or not,
// where you register the router in the middleware pipeline determines
// whether or not the RESTEasy code will be used:
preRouter.get('/api/v0/reviews/moderate', function *(next) {
  this.body = { result: 'NOT IMPLEMENTED' };
});

router.get('/api/v0/reviews/', function*(next) {
  this.body = { result: 'OK', sql: this.resteasy.query.toSQL().sql };
});

app.use(function *(next) {
  var start = new Date();
  yield next;
  var end = new Date();

  if (typeof this.body == 'object') {
    this.body.timing = { duration: end - start };
  }
});

app.use(require('koa-error')());
app.use(helmet()).use(body());

// preRouter doesn't use middleware:
app.use(preRouter.routes());

// router does:
app.use(mount('/api', Resteasy()));
app.use(router.routes());

console.log('Listenting on ' + (process.env.PORT || 3008));
app.listen(process.env.PORT || 3008);

```
