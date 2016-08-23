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
      var res = yield knex.raw('SELECT \n' +
                      'tc.constraint_name, tc.table_name, kcu.column_name,\n' +
                      'ccu.table_name AS foreign_table_name,\n' +
                      'ccu.column_name AS foreign_column_name,\n' +
                      'CASE pgc.confdeltype\n' +
                      'WHEN \'a\' THEN \'NO ACTION\'\n' +
                      'WHEN \'r\' THEN \'RESTRICT\'\n' +
                      'WHEN \'c\' THEN \'CASCADE\'\n' +
                      'WHEN \'n\' THEN \'SET NULL\'\n' +
                      'WHEN \'d\' THEN \'SET DEFAULT\'\n' +
                      'END AS on_delete,\n' +
                      'CASE pgc.confupdtype\n' +
                      'WHEN \'a\' THEN \'NO ACTION\'\n' +
                      'WHEN \'r\' THEN \'RESTRICT\'\n' +
                      'WHEN \'c\' THEN \'CASCADE\'\n' +
                      'WHEN \'n\' THEN \'SET NULL\'\n' +
                      'WHEN \'d\' THEN \'SET DEFAULT\'\n' +
                      'END AS on_update\n' +
                      'FROM \n' +
                      'information_schema.table_constraints AS tc \n' +
                      'JOIN information_schema.key_column_usage AS kcu\n' +
                      'ON tc.constraint_name = kcu.constraint_name\n' +
                      'JOIN pg_constraint AS pgc\n' +
                      'ON pgc.conname = kcu.constraint_name\n' +
                      'JOIN information_schema.constraint_column_usage AS ccu\n' +
                      'ON ccu.constraint_name = tc.constraint_name\n' +
                               'WHERE constraint_type = \'FOREIGN KEY\' AND ( tc.table_name=:table OR ccu.table_name=:table );', { table });

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

