<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep shared-ride rules in a browser-safe domain module and enforce booking capacity and price consent again in transactional database functions; concurrent clients must not oversell seats.
- Shared bookings use Cloud Auth identities and Cloud persistence, independently of the existing in-memory solo-trip demo.
- Count each requested seat as one passenger, split the fare per occupied seat, and freeze capacity before final price consent; this keeps multi-seat reservations and final totals consistent.
