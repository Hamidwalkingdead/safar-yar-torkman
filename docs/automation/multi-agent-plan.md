# Free multi-agent automation plan

## Product delivery rule — production product only

Safar Yar Torkman is to be developed as the real product, not as a disposable prototype, mockup, showcase, or separate demo application. Do not create a parallel demo/test edition or replace real integrations with fake data just to make a screen appear functional.

Development branches, automated tests, staging checks, and debug APKs are engineering safeguards for the same product; they are not separate product editions. They must validate real implementation and must never be presented as a completed production release. The intended deliverable is one integrated application with real authentication, database-backed workflows, map/navigation services, trip lifecycle, messaging, wallet/payment rules, admin controls, and Android packaging. A feature must be clearly reported as incomplete whenever its required provider, credentials, backend configuration, or real-world integration is not in place.

Do not claim the app is production-ready merely because it compiles or a debug APK installs. Production readiness requires the relevant end-to-end checks, security review, real integration verification, and release signing/configuration.

## Goal

Build a cautious, low-cost workflow for Safar Yar Torkman in which specialist agents plan, implement, review, and validate work. The production branch `main` must never be edited directly by an AI agent.

## Current repository baseline

- The repository already has GitHub Actions workflows for CI, Android APK packaging, database migrations, and remote checks.
- The Android workflow runs tests, builds the web application, synchronizes the Capacitor Android project, builds a debug APK, and uploads it as an artifact.
- The README currently describes a prototype/demo and explicitly distinguishes integrations that still require setup. This conflicts with the product delivery rule above and must be reviewed and corrected as part of the real product documentation work; do not silently claim unfinished integrations are complete.
- Lovable is connected to this repository. Do not rewrite published Git history, force-push, rebase, amend, or squash already-published commits.

## Proposed agents

1. **Coordinator / architect** — turns one approved task into small, testable work items and defines acceptance criteria.
2. **Implementation agent (GitHub Copilot where available)** — writes and updates production product code on a task branch; no throwaway demo implementation.
3. **Database and security reviewer** — checks migrations, RLS, authorization, privacy, and transactional invariants.
4. **Independent code reviewer** — inspects the diff for regressions, missing tests, unsafe assumptions, and scope creep.
5. **QA / release agent** — runs lint, unit/integration tests, production build, and Android packaging; reports the exact artifact and run URL.

The first iteration may use different models from one provider if only one free API is available. Different roles do not automatically mean different model vendors. Provider/model identifiers must be configurable, not hard-coded.

## Safe workflow

1. Work starts only from an issue or an explicit `workflow_dispatch` request.
2. Coordinator writes a task plan and acceptance criteria.
3. Implementation happens on a dedicated branch; never on `main`.
4. Static checks and tests run before review.
5. A separate reviewer receives the patch and test evidence, not the implementation agent's self-assessment.
6. If review finds defects, allow at most two repair/review cycles; otherwise stop and report blockers.
7. Open a **draft pull request** with a summary, changed files, tests, known gaps, and artifact links.
8. A human must approve merging. Database migrations, auth/RLS changes, secrets, production deployment, payments, and live user data always require explicit human review.

## Free-first provider strategy

- **GitHub Actions:** standard hosted runners are free for public repositories. Keep workflows bounded with timeouts, concurrency controls, and artifact retention.
- **GitHub Copilot Free:** current plan information lists 2,000 completions per month and Copilot CLI, but does not include the Copilot cloud agent / assigning cloud coding work. Do not assume the Free plan provides a headless coding-agent API for Actions. Copilot can still be used interactively for real code changes where its supported interface is available.
- **Gemini API:** although selected models have a free tier, Google's official supported-region list does not include Iran at the time this plan was prepared. Do not make it the default provider for this project.
- **Local model fallback:** a small quantized model can be run locally, but on a phone it will be slower and less capable than hosted coding models. It is a fallback, not a promise of autonomous production-grade coding.
- **Other hosted free tiers:** availability, regional access, account eligibility, data-use terms, and quotas must be checked against each provider's official documentation before use. Never route around a provider's regional restrictions.

No provider is guaranteed to remain free or available in every country. The system must stop safely on quota exhaustion rather than switch to a paid endpoint.

## Secrets and privacy

- Never commit API keys, access tokens, service-role keys, database URLs containing passwords, signing keys, or user data.
- Add provider credentials only through GitHub Actions repository secrets after the owner chooses a provider.
- Never print secrets in logs or include them in prompts.
- Restrict AI workflows to trusted branches and manual dispatch initially. Do not expose secrets to untrusted fork pull requests.
- The repository is public; treat all committed code and documentation as public.

## Initial implementation phases

### Phase 1 — foundation (this branch)
- Record the architecture, role boundaries, safety rules, provider limitations, and production-product-only rule.
- Preserve `main` and all existing workflows.

### Phase 2 — local/provider adapter
- Add a small provider-neutral client with explicit model IDs, request budgets, timeouts, retry handling, and redaction.
- Prefer a local model runtime if it can run reliably on the available device.
- If a hosted free-tier provider is chosen, add its key only as a repository secret after confirming regional eligibility and data-use terms.
- Do not enable automatic code-writing until the selected execution path is proven to work safely.

### Phase 3 — controlled agent loop
- Add coordinator, implementation, independent-review, and QA steps.
- Require patch-size limits, allowed-path rules, test evidence, and a maximum of two review/repair cycles.
- Open draft PRs only; no automatic merge.

### Phase 4 — Android delivery
- Reuse the existing Android APK workflow.
- Build and verify the real integrated application; debug APKs are for engineering verification and are not a separate demo edition or a production release.
- Publish a release artifact only after all required checks, real integration verification, and release signing/configuration pass.
- Report failed builds and missing runtime configuration honestly.

## Acceptance criteria

- No direct AI commits to `main`.
- No separate demo/prototype edition or fake integrations presented as complete functionality.
- No secrets in repository files or logs.
- Every generated change has a reviewable diff and a draft PR.
- Every PR includes test/build results and known limitations.
- Quota, provider, network, or runner failures stop the workflow with a clear report.
- Existing CI and Android APK workflows remain intact.
- Production readiness is claimed only after end-to-end, security, and release checks pass.

## Important limitations

This plan does not itself create model access or turn on autonomous agents. Unattended model calls require a supported local model runtime or an eligible hosted provider credential. Free-tier quotas are limited and may be unavailable in the user's region. The initial foundation is documentation only; no AI agent is active until the model adapter is implemented and configured.

## Official references

- GitHub Copilot plans: https://github.com/features/copilot/plans
- GitHub Actions runner billing: https://docs.github.com/en/actions/reference/runners/hosted-runners
- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Gemini API available regions: https://ai.google.dev/gemini-api/docs/available-regions
