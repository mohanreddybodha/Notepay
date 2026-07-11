# Contributing to Notepay

Welcome! We appreciate your contributions to the Notepay project. To maintain codebase stability, please follow these guidelines when writing code and submitting pull requests.

---

## 🌿 Branch Naming Conventions

Always create feature branches from `main`. Use the following naming structure:

*   `feature/short-description` (e.g., `feature/upi-receipt-fallback`)
*   `bugfix/short-description` (e.g., `bugfix/cors-exception-handling`)
*   `hotfix/short-description` (e.g., `hotfix/neon-pool-depletion`)
*   `docs/short-description` (e.g., `docs/add-adr-guidelines`)

---

## 💬 Commit Message Guidelines

We follow a structured commit style to keep our Git history clear and readable. Prefix your commits with one of the following labels:

*   `feat`: A new feature (e.g., `feat: add Google Gemini fallback for receipt verification`)
*   `fix`: A bug fix (e.g., `fix: catch clock skew early token errors`)
*   `refactor`: Code restructuring without functional modifications (e.g., `refactor: extract aggregate calculations to sql`)
*   `perf`: Performance optimizations (e.g., `perf: configure WAL mode for SQLite engine`)
*   `docs`: Documentation changes (e.g., `docs: create design system specifications`)
*   `test`: Adding or correcting tests (e.g., `test: add smoke checks for public event views`)

*Example commit message:*
```bash
git commit -m "feat: implement local token validation cache to reduce firebase latency"
```

---

## 💻 Pull Request Standards

Before submitting a Pull Request (PR):
1.  **Run Tests**: Run the smoke testing suite locally inside the `/backend` folder:
    ```bash
    pytest tests/test_smoke.py
    ```
    PRs with failing tests will not be reviewed.
2.  **No Framework Overhead**: Do not introduce frameworks (React, Vue, Tailwind, etc.) unless requested. Keep code within standard Vanilla JS and CSS variables.
3.  **Prevent N+1 Queries**: Ensure that your backend database queries use `joinedload()` and SQL `GROUP BY` aggregates rather than executing database calls inside Python iteration loops.
4.  **Sanitize Input**: Wrap any user-submitted values saved to the database in `crud.sanitize_json_payload()` to prevent stored XSS vulnerabilities.

---

## 🔍 Code Review Process

1.  Submit your PR to target the `main` branch.
2.  Assign at least one core engineer for review.
3.  Address review comments and update the branch.
4.  Once approved and the automated CI/CD checks pass, the reviewer will merge the PR.
