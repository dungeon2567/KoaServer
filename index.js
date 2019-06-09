const { Model, IntType, StringType, DateType, DateTimeType } = require("./Model");

const Cors = require('@koa/cors');

const { createPool } = require('slonik');

const pool = createPool("postgresql://idzaskuf:TQD9KFZOPEpWHej3jrY_YVgpKzogDKan@isilo.db.elephantsql.com:5432/idzaskuf");

const model = new Model(pool);

const Book = model.define("book", "title", {
  id: IntType.computed(),
  title: StringType,
  data_criacao: DateTimeType
});

const Author = model.define("author", "name", {
  id: IntType.computed(),
  name: StringType
});

Author.hasManyThrough("books", Book, "author", "book_author");

const Koa = require("koa");
const Router = require("koa-router");
const koaBody = require("koa-body");

const app = new Koa();
app.use(Cors());
const router = new Router();

app.use(koaBody());

router.get("/api/:resource", async (ctx) => {
  const type = model.types[ctx.params.resource];

  if (!type) {
    ctx.status = 404;
    return;
  }

  const object = await type.search(pool, ctx.query);

  if (!object) {
    ctx.status = 404;
    return;
  }

  ctx.body = object;
});

router.get("/api/:resource/:id", async (ctx) => {
  const type = model.types[ctx.params.resource];

  if (!type) {
    ctx.status = 404;
    return;
  }

  const object = await type.find(pool, ctx.params.id);

  if (!object) {
    ctx.status = 404;
    return;
  }

  ctx.body = object;
});

router.get("/api/:resource/:id/:relation", async (ctx, next) => {
  const type = model.types[ctx.params.resource];

  if (!type) {
    ctx.status = 404;
    return;
  }

  const relation = type.fields[ctx.params.relation];

  if (!relation) {
    ctx.status = 404;
    return;
  }

  const result = await relation.search(pool, ctx.params.id, ctx.query);

  if (!result) {
    ctx.status = 404;
    return;
  }

  ctx.body = result;
});

router.post("/api/:resource/:id", async (ctx, next) => {
  const type = model.types[ctx.params.resource];

  if (!type) {
    ctx.status = 404;
    return;
  }

  const update = type.update(pool, ctx.params.id, ctx.request.body);

  const result = await pool.connect((connection) => {
    return connection.transaction(update);
  });

  if (!result) {
    ctx.status = 404;
    return;
  }

  ctx.body = result;
});

router.post("/api/:resource", async (ctx, next) => {
  const type = model.types[ctx.params.resource];

  if (!type) {
    ctx.status = 404;
    return;
  }

  const insertion = type.insert(pool, ctx.request.body);

  const result = await pool.connect((connection) => {
    return connection.transaction(insertion);
  });

  if (!result) {
    ctx.status = 404;
    return;
  }

  ctx.body = result;
});


router.post("/api/:resource/:id/:relation", async (ctx, next) => {
  const type = model.types[ctx.params.resource];

  if (!type) {
    ctx.status = 404;

    return next();
  }

  const relation = type.relations[ctx.params.relation];

  if (!relation) {
    ctx.status = 404;
    return next();
  }

  ctx.body = await relation.insert(pool, ctx.params.id, ctx.request.body);
});

router.delete("/api/:resource/:id", async (ctx, next) => {
  const type = model.types[ctx.params.resource];

  if (!type) {
    ctx.status = 404;
  }

  ctx.body = await type.delete(pool, ctx.params.id);
});

app.use(router.routes())
  .use(router.allowedMethods());

app.listen(process.env.PORT || 8080);
