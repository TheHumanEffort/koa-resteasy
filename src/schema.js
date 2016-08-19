// eventually, we'll want to cache this information!

module.exports = {
  columns: function(knex, table) {
    return knex.raw('SELECT table_name,column_name,dpata_type FROM information_schema.columns WHERE table_name   = ?', table);
  },

  constraints: function(knex, table) {
    return knex.raw('SELECT \n' +
                    'tc.constraint_name, tc.table_name, kcu.column_name,\n' +
                    'ccu.table_name AS foreign_table_name,\n' +
                    'ccu.column_name AS foreign_column_name,\n' +
                    'CASE pgc.confdeltype,\n' +
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
                    'WHERE constraint_type = \'FOREIGN KEY\' AND tc.table_name=?;', table);
  },
};
