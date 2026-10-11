# Roadmap implementation status

This file maps the stable `CRT-01` through `CRT-22` roadmap identifiers to repository evidence. GitHub pull-request numbers are implementation references, not replacements for roadmap IDs.

Status terms:

- **implemented in core**: the roadmap capability is present in the domain-neutral engine and its implementation PR is merged;
- **superseded in core**: later approved repository-boundary work removed or relocated the named downstream application while preserving reusable engine capabilities;
- **production unverified**: merge and CI evidence do not establish a live deployment, production data, current source refresh, or operational acceptance.

| Roadmap ID | Current core status | Merged evidence |
| --- | --- | --- |
| CRT-01 | Implemented in core | [PR #1](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/1) |
| CRT-02 | Implemented in core | [PR #2](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/2) |
| CRT-03 | Implemented in core | [PR #3](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/3) |
| CRT-04 | Implemented in core | [PR #4](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/4) |
| CRT-05 | Implemented in core | [PR #5](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/5) |
| CRT-06 | Implemented in core | [PR #6](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/6) |
| CRT-07 | Implemented in core | [PR #7](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/7) |
| CRT-08 | Implemented in core | [PR #8](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/8) |
| CRT-09 | Implemented in core | [PR #9](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/9) |
| CRT-10 | Implemented in core | [PR #10](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/10) |
| CRT-11 | Implemented in core | [PR #11](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/11) |
| CRT-12 | Implemented in core | [PR #12](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/12) |
| CRT-13 | Implemented in core | [PR #13](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/13) |
| CRT-14 | Implemented in core | [PR #14](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/14) |
| CRT-15 | Implemented in core | [PR #15](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/15) |
| CRT-16 | Implemented in core | [PR #16](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/16) |
| CRT-17 | Implemented in core | [PR #17](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/17) |
| CRT-18 | Implemented in core | [PR #18](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/18) |
| CRT-19 | Superseded in core; named Open Legal application moved outside the engine boundary | Implemented by [PR #19](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/19), removed from core by [PR #25](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/25) |
| CRT-20 | Generic source, refresh, PDF-ingestion, and reviewable extraction capabilities retained; legal-specific application code superseded in core | [PRs #20-23](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pulls?q=is%3Apr+is%3Aclosed+20..23), boundary enforced by [PR #25](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/25) |
| CRT-21 | Superseded for this repository by the approved domain-neutral core boundary; no Sam Ervin application completion is claimed | [PR #25](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/25) |
| CRT-22 | Superseded in core; Smart Cities is a downstream repository | Implemented by [PR #24](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/24), removed from core by [PR #25](https://github.com/neophilism/Civic-Registry-Transparency-Engine/pull/25) |

## Post-roadmap core increments

PRs #20-23 remain relevant to the reusable engine even though their initial legal application was removed. They add provider-neutral source retrieval, durable source-refresh orchestration, PDF attachment extraction, and reviewable relationship candidates. PR #25 retains these capabilities and adds a core-purity regression test.

## Remaining operational gates

This reconciliation does not prove a production deployment, current source ingestion, branch protection, release tags, backup/restore rehearsal, or downstream application acceptance. Those states require their own repository and environment evidence. Future changes must preserve the generic core boundary and record new approved scope as new roadmap work rather than rewriting this historical mapping.
