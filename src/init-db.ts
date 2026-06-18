import { db } from "./db.js";

db.exec(
  `create table if not exists secrets(
        id text primary key,
        data text,
        views_remaining integer not null,
        expiration_date datetime not null default current_timestamp
    )`,
);
db.exec("create index secrets_idx on secrets(id)");
