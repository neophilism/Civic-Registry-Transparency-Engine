# Shared packages

Shared engine packages will live here. They must remain generic and reusable by
multiple downstream civic applications.

Planned packages include:

- `core`
- `database`
- `registry`
- `search`
- `documents`
- `deadlines`
- `audit`
- `api`
- `ui`
- `config`
- `sdk`

Bill-specific terminology and policy rules belong in downstream applications,
not in these packages unless they can be expressed as generic capabilities.
