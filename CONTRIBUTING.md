# Contributing to IO

Every pull request starts with a maintainer-approved issue. This keeps proposed work intentional, traceable, and reviewable.

## Contribution path

1. Search existing issues, then open the appropriate bug or feature form.
2. Wait for a maintainer to apply `status:approved`; `status:needs-review` is not approval.
3. Create a branch named `type/lowercase-description`, such as `fix/startup-timeout`.
4. Open a PR from the template with `Closes #N`, select one PR type, and apply its matching `type:*` label.
5. Record exact verification results and resolve all automated checks.

The validator rejects PRs when the branch name is invalid, a closing issue is missing, closed, inaccessible, or unapproved, or the PR type selection and label are not exactly one matching pair.

## Branch names

Branches must match:

```text
^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)/[a-z0-9._-]+$
```

## Required labels

Repository maintainers must create these labels before enabling the workflow:

| Purpose | Labels |
|---------|--------|
| Issue intake | `bug`, `enhancement`, `status:needs-review` |
| Maintainer approval | `status:approved` |
| PR type | `type:bug`, `type:feature`, `type:docs`, `type:refactor`, `type:chore`, `type:breaking-change` |

Maintainers approve accepted work by replacing `status:needs-review` with `status:approved`. Contributors must not begin implementation until approval is visible.

## Pull requests

Use `Closes #N`, `Fixes #N`, or `Resolves #N` for every issue the PR will close. Each referenced issue must belong to this repository, remain open, and carry `status:approved`.

Select exactly one type in the PR body and apply the matching label. Keep the summary outcome-focused, identify changed areas, and include the commands or scenarios used for verification.
