# @civic-registry/sdk

TypeScript client for the Civic Registry public API.

The client works with browser/modern Node `fetch` and also accepts an injected
fetch implementation.

```ts
import {
  CivicRegistryClient,
} from "@civic-registry/sdk";

const client = new CivicRegistryClient({
  baseUrl: "https://registry.example",
});

const result = await client.search(
  "public-document-catalog",
  {
    q: "report",
    page: 1,
  },
);
```

API failures throw `CivicRegistryApiError`.

See [Public API, SDK, and exports](../../docs/PUBLIC-API.md).
