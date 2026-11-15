# Security

## Report a vulnerability

Report a vulnerability in private, through GitHub:

1. Open [Report a vulnerability](https://github.com/schmooky/pixi-marrow/security/advisories/new).
2. Describe the problem, the version of `pixi-marrow` and the steps that show it.
3. Attach the smallest skeleton or atlas file that shows it, if a file causes it.

Do not open a public issue for a vulnerability. A public issue tells everyone before a fix exists.

You get an answer in the advisory. When a fix is ready, a new version goes to npm and the advisory becomes public.

## What counts

pixi-marrow reads skeleton and atlas files, and a game can load such files from a server. These are vulnerabilities:

- A file that makes a reader hang, or use memory without limit.
- A file that makes the runtime read or write outside its arrays.
- A file that makes the command line tool write outside the paths you gave it.
- A published package that holds code that is not in this repository.

A file that fails with a `MarrowError` is not a vulnerability. That is the answer the runtime gives to data it does not support.

## Supported versions

Only the newest version on npm gets fixes. Before 1.0 that is the newest `0.x` version under the tag `latest`.
