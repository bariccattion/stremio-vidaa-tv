// #12 / #13 — title passing + mark-as-watched on handoff
// ───────────────────────────────────────────────────────────────────────
// REMOVED. These were two separate IIFEs that each redefined
// window.__launchNativePlayer (one via setInterval+setTimeout to add a title,
// one to wrap it for mark-as-watched). Together with the original they formed a
// three-way race that clobbered each other nondeterministically — and the
// watched wrapper wrote a FAKE 90% progress point (currentTime = duration*0.9)
// on every handoff, corrupting the resume position even when the native player
// never opened.
//
// Both concerns are now folded into the single consolidated launcher above:
//   • title scraping (getPlayerTitle + the detail-page title cache)
//   • mark-as-watched, but ONLY on a VERIFIED handoff and ONLY when the user
//     has enabled the toggle, and WITHOUT ever writing a fake progress point.
// Nothing to install here — kept as a documented tombstone so the patch order
// stays clear.
