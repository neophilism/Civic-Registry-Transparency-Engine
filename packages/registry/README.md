# @civic-registry/registry

Generic presentation helpers for the public registry interface.

The package converts configured records into stable public view models. It does
not contain bill-specific presentation rules.

It uses the compiled registry configuration to determine:

- the record title;
- optional summary;
- record type label;
- configured list fields;
- configured detail fields;
- enum labels;
- generic value formatting.

Downstream applications may override presentation where genuinely necessary,
but the default public interface should work without custom React components.


## Relationship presentation

The package also owns generic relationship semantics:

- outbound, inbound, and undirected presentation;
- inverse labels for directed relationships;
- relationship grouping;
- public graph node/edge view models;
- graph distance presentation.

This keeps relationship wording and direction consistent across HTML interfaces,
JSON APIs, and downstream applications.
