# Secrets

## Getting started

Install dependencies and "build":

```console
$ pnpm install
$ pnpm run build
```

Initialize sqlite database: `node dist/init-db.js`.

And then start the server with `node dist/server.js`.

## Deploy

The files required to deploy are: `dist/*`, `public/*`, `package.json`. Add these to a tar-archive:

```console
$ tar czf secrets.tar.gz dist public package.json
```

And upload to your server.

Now on the server:

1. Unpack with `tar xzf secrets.tar.gz`.
2. Run `pnpm install --prod` to only install "production" dependencies.
3. Initialize sqlite database, `node dist/init-db.js`
4. Start with `node dist/server.js` (and your favorite daemon management tool.)
