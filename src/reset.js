/* ---------------------------------------------------------
   Reset UI + Global Reset Handling
   --------------------------------------------------------- */

function injectResetUI() {
    const host = getResetHostEl();
    if (!host) return;

    if (!canEditTotals()) {
        host.innerHTML = `<div class="note">You do not have permission to reset totals.</div>`;
        return;
    }

    if (host.getAttribute("data-ready") === "1") return;
    host.setAttribute("data-ready", "1");

    host.innerHTML = `
<div class="hp-reset-box">
    <div class="hp-reset-title">Reset Points</div>
    <div class="hp-reset-text">
        This resets the scoreboard totals and clears the global Points Log.
        You will be asked to type <strong>RESET</strong> to confirm.
    </div>
    <div class="hp-reset-actions">
        <button class="button" id="hp-reset-btn">Reset All Points</button>
        <span class="hp-reset-status note" id="hp-reset-status"></span>
    </div>
</div>`;

    document.getElementById("hp-reset-btn").onclick = function () {
        const totals = getTotals();
        const nextVersion = totals.reset_version + 1;

        const teams = getHouseTeamList();
        const types = getPointTypes().filter(t => t.enabled);

        const by_group = {};
        teams.forEach(ht => {
            by_group[ht.group_id] = {};
            types.forEach(t => by_group[ht.group_id][t.type_id] = 0);
        });

        pb.form.gen_verify_box(
            "hp-reset-verify",
            "Reset All Points",
            "240",
            "520",
            "This will reset all scoreboard totals AND clear the global log. Type RESET to confirm.",
            "RESET",
            "Reset",
            function () {
                pb.loading(null, true);
                setTotals({
                    reset_version: nextVersion,
                    reset_ts: nowTs(),
                    by_group,
                    log: [],
                    notifs: []
                }, function (ok) {
                    pb.loading(null, false);
                    document.getElementById("hp-reset-status").textContent =
                        ok ? "Reset complete." : "Reset failed.";

                    renderScoreboard();
                    renderProfile();
                    renderMiniProfiles();
                    updateNotificationsIndicators();
                });
            }
        );
    };
}
