// Interactive architecture diagram for the Contrast nightly CI pipeline.
//
// Self-contained: builds itself into #ci-architecture on DOMContentLoaded and
// wires its own click handlers. Drop it by reverting its commit (this file,
// ci-architecture.css, and the three wiring lines in index.html).
//
// Clicking a node shows its description AND, when the node maps to dashboard
// rows, switches to the right tab and search-filters to surface + flash them.
// Navigation is driven purely through the DOM (tab button + #search-tests
// input event), so it stays decoupled from app.js internals.
//
// The data mirrors the real workflow tree:
//   release_nightly.yml
//     -> e2e_nightly.yml (the "e2e nightly" job, reusable)
//          -> bm_build_image.yml / bm_maintenance_platform.yml
//          -> e2e_nightly_platform.yml -> e2e.yml (per-platform test matrix)
//     -> e2e release matrix (needs the e2e nightly job)
//   release_promote.yml (separate, manually approved gate + publish)

(function () {
  // `tab`/`query` on a stage or job point at where its rows live in the
  // dashboard. `query` must be a substring of the job's name/fullName as the
  // dashboard search matches it (trailing " /" disambiguates SNP from SNP-GPU).
  const PIPELINE = [
    {
      id: 'trigger', icon: '⏰', title: 'Trigger',
      desc: 'release_nightly.yml runs on a daily schedule and can also be dispatched manually.',
      jobs: [
        { name: 'schedule 20:15 UTC', desc: 'Daily cron in release_nightly.yml.' },
        { name: 'workflow_dispatch', desc: 'Manual run of the nightly pipeline.' },
      ],
    },
    {
      id: 'prepare', icon: '🧰', title: 'Prepare', tab: 'release-nightly',
      desc: 'Resolve the nightly version and clear stale draft releases before building.',
      jobs: [
        { name: 'process-inputs', tab: 'release-nightly', query: 'Process inputs', desc: 'Determine the nightly version, working branch and tags.' },
        { name: 'cleanup-nightly-drafts', tab: 'release-nightly', query: 'Clean up old nightly', desc: 'Delete previous nightly draft releases.' },
      ],
    },
    {
      id: 'build', icon: '📦', title: 'Build & publish', tab: 'release-nightly',
      desc: 'Build the artifacts and the draft release. The two builds gate the release.',
      jobs: [
        { name: 'Build & push artifacts', gate: true, tab: 'release-nightly', query: 'Build and push artifacts', desc: 'release-x86_64-linux: builds artifacts and creates the nightly draft release.' },
        { name: 'Build aarch64-darwin CLI', gate: true, tab: 'release-nightly', query: 'aarch64-darwin CLI', desc: 'release-aarch64-darwin: the macOS CLI build.' },
        { name: 'Pre-release artifacts', tab: 'release-nightly', query: 'Pre-release artifacts', desc: 'report-artifacts: posts the artifacts link once.' },
      ],
    },
    {
      id: 'e2e-nightly', icon: '🌙', title: 'e2e nightly', gate: true, reusable: 'e2e_nightly.yml', tab: 'e2e-nightly',
      desc: 'The prerequisite test stage, a reusable workflow that preps the bare-metal runners and runs the full e2e matrix per platform. If it fails, the e2e release stage is skipped, which is exactly the dependency this diagram is meant to make obvious.',
      jobs: [
        { name: 'e2e nightly', gate: true, tab: 'e2e-nightly', query: '', desc: 'Calls e2e_nightly.yml. Opens the e2e nightly tab; expand the internals below.' },
      ],
      expand: [
        {
          id: 'build-image', title: 'build-image', tab: 'release-nightly', query: 'cleanup-bare-metal image',
          desc: 'bm_build_image.yml: builds the cleanup-bare-metal image the maintenance jobs use.',
          jobs: [{ name: 'Build cleanup-bare-metal image', tab: 'release-nightly', query: 'cleanup-bare-metal image', desc: 'Shared prep image for the per-platform maintenance jobs.' }],
        },
        {
          id: 'maintenance', title: 'maintenance ×5', tab: 'release-nightly', query: 'maintenance Metal-QEMU',
          desc: 'bm_maintenance_platform.yml per platform: update-resources, cleanup, nix-gc. Each e2e platform job needs its own maintenance job.',
          jobs: ['Metal-QEMU-SNP', 'Metal-QEMU-TDX', 'Metal-QEMU-SNP-GPU', 'Metal-QEMU-SNP-DEV', 'Metal-QEMU-TDX-GPU']
            .map(p => ({ name: p, tab: 'release-nightly', query: 'maintenance ' + p + ' /', desc: 'update-resources / cleanup / nix-gc on ' + p + '.' })),
        },
        {
          id: 'tests', title: 'e2e tests ×4', tab: 'e2e-nightly', query: '',
          desc: 'Per platform, e2e_nightly_platform.yml fans out ~22 tests × debug-shell (plus a debug set) into e2e.yml.',
          jobs: ['Metal-QEMU-SNP', 'Metal-QEMU-TDX', 'Metal-QEMU-SNP-GPU', 'Metal-QEMU-TDX-GPU']
            .map(p => ({ name: p, tab: 'e2e-nightly', query: p + ' /', desc: p + ': atls, attestation, coordinator, policy, regression, … each as a base and a debug-shell variant via e2e.yml.' })),
        },
        {
          id: 'notify', title: 'notify-teams',
          desc: 'Posts a Teams message summarising failures on scheduled runs. Not tracked as a dashboard row.',
          jobs: [{ name: 'Notify teams channel of failure', desc: 'Failure notification for the nightly cron.' }],
        },
      ],
    },
    {
      id: 'e2e-release', icon: '🚀', title: 'e2e release', gate: true, tab: 'release-nightly', query: 'e2e release on',
      desc: 'Matrix of 4 platforms × 2 CLI arches. It needs the e2e nightly job, so a failing nightly leaves these skipped (one ghost row with an un-expanded ${{ matrix... }} name).',
      jobs: [
        { name: 'e2e release on <platform> (<arch>)', gate: true, tab: 'release-nightly', query: 'e2e release on', desc: '8 jobs: {SNP, TDX, SNP-GPU, TDX-GPU} × {x86_64-linux, aarch64-darwin}.' },
      ],
    },
    {
      id: 'promote', icon: '✅', title: 'Promote', manual: true, reusable: 'release_promote.yml',
      desc: 'A separate, manually approved workflow (release_promote.yml). It verifies every release-requirement job passed in the latest nightly, then promotes and publishes the release. Not scraped into the dashboard.',
      jobs: [
        { name: 'verify nightly + publish', desc: 'release_promote.yml: the gate on the nightly run plus the publish steps.' },
      ],
    },
  ];

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function badges(stage) {
    const out = [];
    if (stage.gate) out.push('<span class="ci-badge gate">release gate</span>');
    if (stage.reusable) out.push('<span class="ci-badge reusable">' + esc(stage.reusable) + '</span>');
    if (stage.manual) out.push('<span class="ci-badge manual">manual</span>');
    return out.join('');
  }

  // A clickable node carries its own title/desc (for the detail panel) and an
  // optional tab/query (for navigation), all via data-* attributes.
  function node(cls, title, item) {
    let attrs = ' data-title="' + esc(title) + '" data-desc="' + esc(item.desc || title) + '"';
    if (item.gate) attrs += ' data-gate="1"';
    if (item.tab) attrs += ' data-tab="' + esc(item.tab) + '"';
    if (item.tab) attrs += ' data-query="' + esc(item.query || '') + '"';
    return '<span class="ci-node ' + cls + (item.tab ? ' ci-link' : '') + '"' + attrs + '>' + esc(title) + '</span>';
  }

  function chips(stage) {
    return stage.jobs.map(j => node('ci-chip' + (j.gate ? ' gate' : ''), j.name, j)).join('');
  }

  function stageCard(stage) {
    const expand = stage.expand
      ? '<button class="ci-expand" data-expand="' + stage.id + '" aria-expanded="false">▸ internals</button>'
      : '';
    return '<div class="ci-stage" data-stage="' + stage.id + '">' +
      '<div class="ci-stage-head">' +
        node('ci-stage-title', (stage.icon ? stage.icon + ' ' : '') + stage.title, stage) +
        badges(stage) +
      '</div>' +
      '<div class="ci-chips">' + chips(stage) + '</div>' +
      expand +
    '</div>';
  }

  function subPipeline(stage) {
    const cards = stage.expand.map(sub =>
      '<div class="ci-stage sub" data-stage="' + stage.id + ':' + sub.id + '">' +
        '<div class="ci-stage-head">' + node('ci-stage-title', sub.title, sub) + '</div>' +
        '<div class="ci-chips">' + chips(sub) + '</div>' +
      '</div>'
    ).join('<span class="ci-arrow">→</span>');
    return '<div class="ci-sub-label">' + esc(stage.title) + ' internals (' + esc(stage.reusable || '') + ')</div>' +
      '<div class="ci-flow">' + cards + '</div>';
  }

  function showDetail(root, el) {
    const panel = root.querySelector('.ci-detail');
    const gate = el.dataset.gate ? ' <span class="ci-badge gate">release gate</span>' : '';
    const hint = el.dataset.tab ? '<span class="ci-detail-hint"> · jumps to the job in its tab</span>' : '';
    panel.innerHTML = '<strong>' + esc(el.dataset.title) + '</strong>' + gate + hint + '<br>' + esc(el.dataset.desc);
  }

  // Switch to the node's tab and search-filter to its job(s), then scroll to
  // and flash the matching rows. Driven via the DOM so app.js stays untouched.
  function navigate(tab, query) {
    const btn = document.querySelector('#contrast-content .tab[data-tab="' + tab + '"]');
    if (btn) btn.click();
    const search = document.getElementById('search-tests');
    if (search) {
      search.value = query || '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    requestAnimationFrame(() => {
      const content = document.getElementById('contrast-content');
      if (!content) return;
      const rows = Array.from(content.querySelectorAll('.test-row'));
      const target = rows[0] || content.querySelector('.tabs');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (query) {
        rows.slice(0, 50).forEach(r => {
          r.classList.add('ci-flash');
          setTimeout(() => r.classList.remove('ci-flash'), 1600);
        });
      }
    });
  }

  // --- Status rollup -------------------------------------------------------
  // Read the dashboard's loaded data (app.js's top-level `state`) and derive a
  // status for each linked node by aggregating its matching rows. `state` is a
  // `let` global, so it is not on window and may be in its temporal dead zone
  // until app.js runs; guard accordingly.
  function getState() {
    try { return state; } catch (e) { return null; }
  }

  function tierTests(tab) {
    const st = getState();
    const data = st && st.tiersData && st.tiersData[tab];
    if (!data) return null;
    const out = [];
    (data.allJobsSection && data.allJobsSection.tests || []).forEach(t => out.push(t));
    (data.sections || []).forEach(s => (s.tests || []).forEach(t => out.push(t)));
    return out;
  }

  function matchStatus(tab, query) {
    const tests = tierTests(tab);
    if (!tests) return null; // data not loaded yet
    const q = (query || '').toLowerCase();
    const matches = q
      ? tests.filter(t => (t.jobName || t.fullName || t.name || '').toLowerCase().includes(q))
      : tests;
    if (!matches.length) return 'none';
    const st = matches.map(t => t.status);
    if (st.includes('failed')) return 'failed';
    if (st.includes('running')) return 'running';
    if (st.every(s => s === 'passed' || s === 'flaky')) return 'passed';
    return 'not_run';
  }

  function applyStatuses(scope) {
    if (!scope) return false;
    let ready = true;
    scope.querySelectorAll('.ci-chip.ci-link').forEach(chip => {
      const status = matchStatus(chip.dataset.tab, chip.dataset.query);
      if (status === null) { ready = false; return; }
      let dot = chip.querySelector('.ci-stat');
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'ci-stat';
        chip.insertBefore(dot, chip.firstChild);
      }
      dot.className = 'ci-stat ' + status;
      dot.title = 'latest run: ' + status.replace('_', ' ');
    });
    return ready;
  }

  function applyStatusesWhenReady(root, attempt) {
    attempt = attempt || 0;
    const done = applyStatuses(root.querySelector('.ci-flow-main'));
    if (!done && attempt < 40) {
      setTimeout(() => applyStatusesWhenReady(root, attempt + 1), 300);
    }
  }

  function render(root) {
    const flow = PIPELINE.map(stageCard).join('<span class="ci-arrow">→</span>');
    root.innerHTML =
      '<div class="ci-arch">' +
        '<button class="ci-arch-toggle" aria-expanded="false">▸ CI pipeline</button>' +
        '<div class="ci-arch-body" hidden>' +
          '<div class="ci-flow ci-flow-main">' + flow + '</div>' +
          '<div class="ci-subflow" hidden></div>' +
          '<div class="ci-detail">Click any node for its description. Accent, underlined <span class="ci-node ci-link" style="pointer-events:none">↪ nodes</span> jump to that job in its tab; dashed grey nodes (like workflow_dispatch) are informational only. The “internals” button expands the e2e nightly sub-pipeline.</div>' +
        '</div>' +
      '</div>';

    root.addEventListener('click', e => {
      const toggle = e.target.closest('.ci-arch-toggle');
      if (toggle) {
        const body = root.querySelector('.ci-arch-body');
        const open = body.hidden;
        body.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = (open ? '▾' : '▸') + ' CI pipeline';
        return;
      }
      const exp = e.target.closest('.ci-expand');
      if (exp) {
        const sub = root.querySelector('.ci-subflow');
        const stage = PIPELINE.find(s => s.id === exp.dataset.expand);
        const open = sub.hidden;
        if (open) {
          sub.innerHTML = subPipeline(stage);
          sub.hidden = false;
          exp.setAttribute('aria-expanded', 'true');
          exp.textContent = '▾ internals';
          applyStatuses(sub);
        } else {
          sub.hidden = true;
          sub.innerHTML = '';
          exp.setAttribute('aria-expanded', 'false');
          exp.textContent = '▸ internals';
        }
        return;
      }
      const n = e.target.closest('.ci-node');
      if (n) {
        const wasActive = n.classList.contains('active');
        root.querySelectorAll('.ci-node.active').forEach(x => x.classList.remove('active'));
        n.classList.add('active');
        showDetail(root, n);
        // First click selects + describes; if it's a linked node, also jump.
        if (n.dataset.tab) navigate(n.dataset.tab, n.dataset.query);
      }
    });

    applyStatusesWhenReady(root);
  }

  function init() {
    const root = document.getElementById('ci-architecture');
    if (root) render(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
