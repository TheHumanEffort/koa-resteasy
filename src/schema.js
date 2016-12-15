// eventually, we'll want to cache this information!

var _ = require('lodash');
var schemas = [];

function memoize(fn) {
  var cache = {};
  return function*(table) {
    if (cache[table]) {
      return cache[table];
    } else {
      var val = yield fn.call(this, table);
      cache[table] = val;
      return val;
    }
  };
}

function Schema(knex) {
  return {
    columns: memoize(function *(table) {
      var res = yield knex.raw('SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_name   = ?', table);
      return res.rows;
    }),

    constraints: memoize(function *(table) {
       var query = "SELECT \n"+
       "  conname as constraint_name,\n"+
       "   conrelid::regclass AS table_name,\n"+
       "   pga.attname as column_name,\n"+
       "   confrelid::regclass as foreign_table_name,\n"+
       "   pga2.attname as foreign_column_name,\n"+
       "   CASE c.confdeltype\n"+
       "     WHEN 'a' THEN 'NO ACTION'\n"+
       "     WHEN 'r' THEN 'RESTRICT'\n"+
       "     WHEN 'c' THEN 'CASCADE'\n"+
       "     WHEN 'n' THEN 'SET NULL'\n"+
       "     WHEN 'd' THEN 'SET DEFAULT'\n"+
       "   END AS on_delete,\n"+
       "   CASE c.confupdtype\n"+
       "     WHEN 'a' THEN 'NO ACTION'\n"+
       "     WHEN 'r' THEN 'RESTRICT'\n"+
       "     WHEN 'c' THEN 'CASCADE'\n"+
       "     WHEN 'n' THEN 'SET NULL'\n"+
       "     WHEN 'd' THEN 'SET DEFAULT'\n"+
       "   END AS on_update,\n"+
       "   contype,\n"+
       "   pg_get_constraintdef(c.oid) AS cdef\n"+
       " FROM pg_constraint c, pg_namespace n, \n"+
       " pg_attribute pga, pg_attribute pga2\n"+
       " WHERE n.oid = c.connamespace\n"+
       " AND contype IN ('f') \n"+
       " AND n.nspname = 'public' \n"+
       " AND conrelid::regclass::text IN ('"+ table +"') \n"+
       " AND conrelid = pga.attrelid\n"+
       " AND pga.attnum = conkey[1]\n"+
       " AND confrelid = pga2.attrelid\n"+
       " AND pga2.attnum = confkey[1]\n"+
       " ORDER BY conrelid::regclass::text, contype DESC;"

      var res = yield knex.raw(query);
      return res.rows;
    }),

    relations: memoize(function *(table) {
      var constraints = (yield this.constraints(knex, table)).rows;

      var relations = {};

      for (var i = 0; i < constraints.length; i++) {
        var constraint = constraints[i];
        console.error('COnstraint for ' + table + ' ', constraint);

        if (constraint.foreign_table_name == table) {
          // hasMany
          relations[constraint.table_name] = {
            type: 'hasMany',
            foreignColumn: constraint.column_name,
            foreignTable: constraint.table_name,
            column: constraint.foreign_column_name,
            onDelete: constraint.on_delete,
            onUpdate: constraint.on_update,
          };
        } else if (constraint.table_name == table) {
          // belongsTo
          var name = constraint.column_name.match(/^(.*?)_id$/)[1];
          relations[name] = {
            type: 'belongsTo',
            foreignColumn: constraint.foreign_column_name,
            foreignTable: constraint.foreign_table_name,
            column: constraint.column_name,
            onDelete: constraint.on_delete,
            onUpdate: constraint.on_update,
          };
        }

      }

      return relations;
    }),
  };
};

module.exports = function(knex) {
  var schema = _.find(schemas, function(s) { return s.knex === knex; });

  if (!schema) {
    schema = { schema: Schema(knex), knex: knex };
    schemas.push(schema);
  }

  return schema.schema;
};

