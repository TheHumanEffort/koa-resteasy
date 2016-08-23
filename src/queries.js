const _ = require('lodash');

function ns(field, table) {
  if (table) return `${ table }.${ field }`;
  else return field;
}

module.exports = {
  create: function(query, hash) {
    return query.insert(hash).returning('*');
  },

  // read(query,123,'users'), table is optional for when you are
  // JOINing and need to be specific.
  read: function(query, id, table) {
    return query.where(ns('id', table), id);
  },

  update: function(query, id, hash) {
    return query.where('id', id).update(hash, true).returning('*');
  },

  destroy: function(query, id) {
    return query.where('id', id).del();
  },

  whereFromHash: function(query, hash) {
    console.error('WHERE FROM HASH: ', hash);
    _.each(hash, function(value, key) {

      if (value.match(/^NULL$/)) {
        query = query.where(key, 'IS', null);
      } else if (value.match(/^!NULL$/)) {
        query = query.where(key, 'IS NOT', null);
      } else if (value.match(/^\-?[0-9.\-Ee]+$/)) {
        query = query.where(key, '=', Number(value));
      } else {
        query = query.where(key, 'ILIKE', value);
      }
    });

    return query;
  },

  order: function(query, ordering) {
    if (!ordering) return;

    _.each(ordering.split(','), function(piece) {
      var m = piece.match(/^([+-]?)(.*?)$/);
      if (!m) return;

      var direction = ((m[1] == '-') ? 'desc' : 'asc');
      var column = m[2];

      query = query.orderBy(column, direction);
    });

    return query;
  },

  window: function(query, offset, limit) {
    if (offset) query.offset(Number(offset));
    if (limit) query.limit(Number(limit));
    return query;
  },

  select: function(query, fields, table) {
    if (fields) {
      query.select(_.map(fields.split(','), function(field) { return ns(field, table); }));
    } else {
      query.select(ns('*', table));
    }

    return query;
  },
};

