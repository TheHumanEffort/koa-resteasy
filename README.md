# koa-resteasy
REST endpoint middleware for Koa &amp; Knex, currently only supports Koa 1 and Postgres.

## Usage

```
npm install --save koa-resteasy
```

```
var Resteasy = require('koa-resteasy')(knex_instance);

// omitting table option makes it a generic instance:
router.use('/api/v0/',Resteasy());

// adding the table thing, collapses the RESTEasy instance to just one
// table:
var reviewsRest = Resteasy({ table: 'reviews' });

router.use('/api/v0/reviews', reviewsRest);
// and you can add routes taht leverage the REST middleware:
router.get('/api/v0/reviews/', reviewsRest, function*(next) {
this.body = { result: 'OK', sql: this.resteasy.query.toSQL().sql };
this.resteasy.query = null;
});

// or not:
router.get('/api/v0/reviews/moderate', function *(next) {
this.body = { result: 'NOT IMPLEMENTED' };
})
```
