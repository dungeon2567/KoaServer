const {
  sql
} = require('slonik');

class Type {
  optional() {
    if (!this.__optional) {
      this.__optional = new OptionalType(this);
    }

    return this.__optional;
  }

  computed() {
    if (!this.__computed) {
      this.__computed = new ComputedType(this);
    }

    return this.__computed;
  }

  parse(val) {
    return val;
  }

  include(field, context) {
    context.columns.push(sql `${sql.identifier([field.parent.name, field.name])} as ${sql.identifier([field.name])}`);
  }

  insertChildren(pool, val) {
    if (val !== undefined)
      throw new Error();
  }
}

const StringType = new class extends Type {
  get name() {
    return "String";
  }
};

const IntType = new class extends Type {
  get name() {
    return "Int";
  }
};

const DecimalType = new class extends Type {
  get name() {
    return "Decimal";
  }
};

const DateTimeType = new class extends Type {
  get name() {
    return "DateTime";
  }

  parse(dateTimeString) {
    if (dateTimeString == null)
      throw new Error();

    return new Date(dateTimeString).toISOString();
  }

  include(field, context) {
    context.columns.push(sql `to_json(${sql.identifier([field.parent.name, field.name])})#>>'{}' as ${sql.identifier([field.name])}`);
  }
}

const TimeType = new class extends Type {
  get name() {
    return "Time";
  }

  include(field, context) {
    context.columns.push(sql `to_json(${sql.identifier([field.parent.name, field.name])})#>>'{}' as ${sql.identifier([field.name])}`);
  }
}

const DateType = new class extends Type {
  get name() {
    return "Date";
  }

  include(field, context) {
    context.columns.push(sql `to_json(${sql.identifier([field.parent.name, field.name])})#>>'{}' as ${sql.identifier([field.name])}`);
  }
}

class OptionalType extends Type {
  constructor(source) {
    super();

    this.source = source;
  }

  get name() {
    return `Optional(${this.source.name})`;
  }

  parse(val) {
    if (val === null)
      return null;

    return this.source.parse(val);
  }
}

class ComputedType extends Type {
  constructor(source) {
    super();

    this.source = source;
  }

  get name() {
    return `Computed(${this.source.name})`;
  }

  parse(val) {
    if (val === undefined)
      return undefined;

    throw new Error();
  }
}

class Field {
  constructor(parent, name, type) {
    this.parent = parent;
    this.name = name;
    this.type = type;
  }

  async find(pool, key) {
    const {
      rows: [result]
    } = await pool.query(sql `select ${sql.identifier([this.name])} from ${sql.identifier([this.parent.name])} where id = ${key}`);

    if (result) {
      return result[this.name];
    } else
      return null;
  }

  async search(pool, key) {
    const {
      rows: [result]
    } = await pool.query(sql `select ${sql.identifier([this.name])} from ${sql.identifier([this.parent.name])} where id = ${key}`);

    if (result) {
      return result[this.name];
    } else
      return null;
  }

  parse(val) {
    return this.type.parse(val);
  }

  upsertChildren(context, val) {
    val = this.type.parse(val);

    if (val !== undefined) {
      context.assignmentList[this.name] = val;
    }
  }

  insertChildren(context, val) {
    val = this.type.parse(val);

    if (val !== undefined) {
      context.columns.push({
        field: this.name,
        value: val
      });
    }
  }

  include(context) {
    this.type.include(this, context);
  }
}

class UserType extends Type {
  constructor(name, fields, label) {
    super();

    this.name = name;
    this.label = label;
    this.fields = {};

    for (const fieldName in fields) {
      const fieldType = fields[fieldName];

      this.fields[fieldName] = new Field(this, fieldName, fieldType);
    }
  }

  buildFilters(queryParams) {
    const filters = [];

    for (const queryParam in queryParams) {
      const [fieldName, op] = queryParam.split(':');

      const field = this.fields[fieldName];

      if (!field) {
        throw new Error();
      }

      const value = field.type.parse(queryParams[queryParam]);

      switch (op) {
        case "eq":
          filters.push(sql `${sql.identifier([fieldName])} = ${value}`);
          break;
        case "ne":
          filters.push(sql `${sql.identifier([fieldName])} != ${value}`);
          break;
      }
    }

    return filters;
  }

  hasManyThrough(name, type, foreignKey, through) {
    const relation = new HasManyThroughRelation(type, foreignKey, through);
    const inverseRelation = new ReferencesManyThroughRelation(this, name, through);

    relation.inverseRelation = inverseRelation;
    inverseRelation.inverseRelation = relation;

    this.fields[name] = relation;
    type.fields[foreignKey] = inverseRelation;
  }

  referencesManyThrough(name, type, foreignKey, through) {
    const relation = new ReferencesManyThroughRelation(type, foreignKey, through);
    const inverseRelation = new ReferencesManyThroughRelation(this, name, through);

    relation.inverseRelation = inverseRelation;
    inverseRelation.inverseRelation = relation;

    this.fields[name] = relation;
    type.fields[foreignKey] = inverseRelation;
  }

  hasMany(name, type, foreignKey) {
    const relation = new HasManyRelation(type, foreignKey);
    const inverseRelation = new ReferencesOneRelation(this, name);

    relation.inverseRelation = inverseRelation;
    inverseRelation.inverseRelation = relation;

    this.fields[name] = relation;
    type.fields[foreignKey] = inverseRelation;
  }

  referencesMany(name, type, foreignKey) {
    const relation = new ReferencesManyRelation(type, foreignKey);
    const inverseRelation = new ReferencesOneRelation(this, name);

    relation.inverseRelation = inverseRelation;
    inverseRelation.inverseRelation = relation;

    this.fields[name] = relation;
    type.fields[foreignKey] = inverseRelation;
  }

  referencesOne(name, type, foreignKey) {
    const relation = new ReferencesOneRelation(type, name);
    const inverseRelation = new ReferencesManyRelation(this, foreignKey);

    relation.inverseRelation = inverseRelation;
    inverseRelation.inverseRelation = relation;

    this.fields[name] = relation;
    type.fields[foreignKey] = inverseRelation;
  }

  async find(pool, key) {
    const columns = [];
    const joins = [];

    const context = {
      columns,
      joins,
    };

    for (const field of Object.values(this.fields)) {
      field.include(context);
    }

    var query = sql `select ${context.columns.reduce((a, b) => sql`${a}, ${b}`)} from ${sql.identifier([this.name])}`;

    for (const join of context.joins) {
      query = join(query);
    }

    query = sql `${query} where ${sql.identifier([this.name, 'id'])} = ${key}`;

    const {
      rows: [object]
    } = await pool.query(query);

    return object;
  }

  async search(pool, queryParams) {
    const columns = [];
    const joins = [];

    const context = {
      columns,
      joins,
    };

    for (const field of Object.values(this.fields)) {
      field.include(context);
    }

    var query = sql `select ${context.columns.reduce((a, b) => sql`${a}, ${b}`)} from ${sql.identifier([this.name])}`;

    for (const join of context.joins) {
      query = join(query);
    }

    const filters = this.buildFilters(queryParams);

    if (filters.length > 0) {
      query = sql `${query} where ${filters.reduce((a, b) => sql`${a} and ${b}`)}`;
    }

    const {
      rows: objects
    } = await pool.query(query);

    return objects;
  }

  insert(pool, obj) {
    if (obj == null)
      throw new Error();

    if (obj.constructor !== Object)
      throw new Error();

    const context = {
      columns: [],
      children: []
    };

    for (const fieldName in this.fields) {
      this.fields[fieldName]
        .insertChildren(context, obj[fieldName]);
    }

    return async (transaction) => {
      const query = sql `insert into ${sql.identifier([this.name])}
        (${sql.identifierList(context.columns.map(col => [col.field]))}) values 
        (${sql.valueList(context.columns.map(col => col.value))}) returning id`;

      const {
        rows: [{
          id
        }]
      } = await transaction.query(query);

      await Promise.all(context.children.map(child => {
        return child(transaction, id);
      }));

      return id;
    };
  }

  update(pool, id, delta) {
    if (delta == null)
      throw new Error();

    if (delta.constructor !== Object)
      throw new Error();

    const context = {
      assignmentList: {},
      children: []
    };

    for (const fieldName in this.fields) {
      this.fields[fieldName]
        .upsertChildren(context, delta[fieldName]);
    }

    return async (transaction) => {
      const query = sql `update ${sql.identifier([this.name])} set ${sql.assignmentList(context.assignmentList)} 
        where ${sql.identifier([this.name, 'id'])} = ${id}`;

      await Promise.all([transaction.query(query), ...context.children.map(child => {
        return child(transaction, id);
      })]);

      return id;
    };
  }
}

class ReferencesManyRelation extends Type {
  constructor(type, foreignKey) {
    super();

    this.type = type;
    this.foreignKey = foreignKey;
  }

  async search(pool, key, queryParams) {
    const columns = [];
    const joins = [];

    const context = {
      columns,
      joins,
    };

    for (const field of Object.values(this.fields)) {
      field.include(context);
    }

    var query = sql `select ${context.columns.reduce((a, b) => sql`${a}, ${b}`)} from ${sql.identifier([this.type.name])}`;

    for (const join of context.joins) {
      query = join(query);
    }

    const filters = this.type.buildFilters(queryParams);

    filters.push(sql `${sql.identifier([this.type.name, this.foreignKey])} = ${key}`);

    if (filters.length > 0) {
      query = sql `${query} where ${filters.reduce((a, b) => sql`${a} and ${b}`)}`;
    }

    const {
      rows: objects
    } = await pool.query(query);

    return objects;
  }

  include(context) {
    if (this.type.label) {
      context.columns.push(sql `(select array_agg(json_build_object('value', id, 'label', ${sql.identifier([this.type.label])}) order by id) from ${sql.identifier([this.type.name])} where ${sql.identifier([this.type.name, this.foreignKey])} = ${sql.identifier([this.inverseRelation.type.name, 'id'])}) as ${sql.identifier([this.inverseRelation.foreignKey])}`);
    }
  }
}

class HasManyRelation extends ReferencesManyRelation {
  constructor(type, foreignKey) {
    super(type, foreignKey);
  }

  insertChildren(context, vals) {
    for (const val of vals) {

    }

    context.children.push(async (transaction, parentId) => {
      await transaction.query(sql `insert into ${sql.identifier([this.through])}(${sql.identifierList([[this.inverseRelation.type.name], [this.type.name]])})
        values ${sql.tupleList(vals.map(val => [parentId, val]))} on conflict do nothing`);

      return await transaction.query(sql `delete from ${sql.identifier([this.through])} 
        where ${sql.identifier([this.through, this.inverseRelation.type.name])} = ${parentId} and ${sql.identifier([this.through, this.type.name])} != all (${sql.array(vals, 'int4')})`);
    });
  }
}

class ReferencesOneRelation extends Type {
  constructor(type, foreignKey) {
    super();

    this.type = type;
    this.foreignKey = foreignKey;
  }

  insertChildren(pool, val) {
    if (!Number.isInteger(val)) {
      throw new Error();
    }

    if (val !== undefined) {
      context.columns.push({
        field: this.name,
        value: val
      });
    }
  }

  async search(pool, key, queryParams) {
    const columns = [];
    const joins = [];

    const context = {
      columns,
      joins,
    };

    for (const field of Object.values(this.fields)) {
      field.include(context);
    }

    var query = sql `select ${context.columns.reduce((a, b) => sql`${a}, ${b}`)} from ${sql.identifier([this.type.name])}`;

    for (const join of context.joins) {
      query = join(query);
    }

    query = sql `${query} join ${sql.identifier([this.inverseRelation.type.name])} as ${sql.identifier([this.foreignKey])} on ${sql.identifier([this.type.name, 'id'])} = ${sql.identifier([this.foreignKey, this.inverseRelation.foreignKey])}`;

    const filters = this.type.buildFilters(queryParams);

    filters.push(sql `${sql.identifier([this.foreignKey, 'id'])} = ${key}`);

    if (filters.length > 0) {
      query = sql `${query} where ${filters.reduce((a, b) => sql`${a} and ${b}`)}`;
    }

    const {
      rows: [object]
    } = await pool.query(query);

    return object;
  }

  include(context) {
    context.joins.push(query => sql `${query} join ${sql.identifier([this.type.name])} as ${sql.identifier([this.inverseRelation.foreignKey])} 
      on ${sql.identifier([this.type.name, 'id'])} = ${sql.identifier([this.inverseRelation.type.name, this.inverseRelation.foreignKey])}`);

    context.columns.push(sql `json_build_object('value', ${sql.identifier([this.inverseRelation.foreignKey, 'id'])}, 'label', ${sql.identifier([this.inverseRelation.foreignKey, this.type.label])}) as ${sql.identifier([this.inverseRelation.foreignKey])}`);
  }
}

class ReferencesManyThroughRelation extends Type {
  constructor(type, foreignKey, through) {
    super();

    this.type = type;
    this.foreignKey = foreignKey;
    this.through = through;
  }

  include(context) {
    context.columns.push(sql `(select array_agg(json_build_object('value', ${sql.identifier([this.inverseRelation.foreignKey, 'id'])}, 'label', ${sql.identifier([this.inverseRelation.foreignKey, this.type.label])}) order by ${sql.identifier([this.inverseRelation.foreignKey, 'id'])}) 
      from ${sql.identifier([this.type.name])} as ${sql.identifier([this.inverseRelation.foreignKey])}
      join ${sql.identifier([this.through])} on ${sql.identifier([this.through, this.type.name])} = ${sql.identifier([this.inverseRelation.foreignKey, 'id'])}
      where ${sql.identifier([this.through, this.type.name])} = ${sql.identifier([this.inverseRelation.foreignKey, 'id'])}) as ${sql.identifier([this.inverseRelation.foreignKey])}`);
  }

  async search(pool, key, queryParams) {
    const columns = [];
    const joins = [];

    const context = {
      columns,
      joins,
    };

    for (const field of Object.values(this.type.fields)) {
      field.include(context);
    }

    var query = sql `select ${context.columns.reduce((a, b) => sql`${a}, ${b}`)} from ${sql.identifier([this.type.name])}`;

    for (const join of context.joins) {
      query = join(query);
    }

    query = sql `${query} join ${sql.identifier([this.through])} on ${sql.identifier([this.through, this.type.name])} = ${sql.identifier([this.type.name, 'id'])}`;

    const filters = this.type.buildFilters(queryParams);

    filters.push(sql `${sql.identifier([this.through, this.inverseRelation.type.name])} = ${key}`);

    if (filters.length > 0) {
      query = sql `${query} where ${filters.reduce((a, b) => sql`${a} and ${b}`)}`;
    }

    const {
      rows: objects
    } = await pool.query(query);

    return objects;
  }
}

class HasManyThroughRelation extends ReferencesManyThroughRelation {
  constructor(type, foreignKey, through) {
    super(type, foreignKey, through);
  }

  insertChildren(context, vals) {
    for (const val of vals) {
      if (!Number.isInteger(val))
        throw new Error();
    }

    context.children.push((transaction, parentId) => {
      return transaction.query(sql `insert into ${sql.identifier([this.through])}(${sql.identifierList([[this.inverseRelation.type.name], [this.type.name]])})
        values ${sql.tupleList(vals.map(val => [parentId, val]))} on conflict do nothing`);
    });
  }

  upsertChildren(context, vals) {
    for (const val of vals) {
      if (!Number.isInteger(val))
        throw new Error();
    }

    context.children.push(async (transaction, parentId) => {
      await transaction.query(sql `insert into ${sql.identifier([this.through])}(${sql.identifierList([[this.inverseRelation.type.name], [this.type.name]])})
        values ${sql.tupleList(vals.map(val => [parentId, val]))} on conflict do nothing`);

      return await transaction.query(sql `delete from ${sql.identifier([this.through])} 
        where ${sql.identifier([this.through, this.inverseRelation.type.name])} = ${parentId} and ${sql.identifier([this.through, this.type.name])} != all (${sql.array(vals, 'int4')})`);
    });
  }
}

class Model {
  constructor() {
    this.types = {};
  }

  define(name, label, fields) {
    const type = new UserType(name, fields, label);

    this.types[name] = type;

    return type;
  }
}

module.exports = {
  Model,
  StringType,
  IntType,
  DateTimeType,
  DateType,
  DecimalType,
  TimeType
};