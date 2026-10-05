# Contributing

## Design principle

This repository is reusable civic infrastructure, not the implementation of one
specific bill. Before adding a domain-specific concept to the engine, ask
whether multiple downstream applications can express it generically.

## Workflow

1. Create a focused branch.
2. Keep the change scoped to one architectural milestone.
3. Add or update tests for behavior introduced by the change.
4. Run `pnpm ci`.
5. Open a pull request describing the reusable capability and any downstream
   application that motivated it.

## Definition of done

A change is ready to merge when:

- lint passes;
- TypeScript type checking passes;
- automated tests pass;
- the production build succeeds;
- documentation reflects new public configuration or architecture;
- no secrets or real sensitive government/person data are committed.
