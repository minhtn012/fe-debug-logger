# Project Roadmap

## Current Status

**Version**: 0.3.0 (tag `v0.3.0`, 2026-09-25)
**Distribution**: [Chrome Web Store](https://chromewebstore.google.com/detail/fe-debug-logger/gjmlfcmchkdnoocoalcomchocbncdlii) (0.3.0 submitted for review; the store serves the previous version until approved) and Load unpacked from GitHub
**Builds**: FE Debug Logger (full) and FE Feedback (feedback only), both packed by `build.sh`

## Release History

| Version | Date | Highlights |
|---------|------|------------|
| 0.1.0 | 2026-03-13 | Console, user action, network, React/Vue state capture; Markdown export; popup with 4 capture toggles; sensitive field masking |
| 0.2.0 | 2026-03-14 | DOM annotation (hotkey), full-page and region screenshots, ZIP export, MCP server for Claude Code |
| 0.2.1 | 2026-03-25 | Console dedup, full network details with headers and curl, more reliable MCP server with live log streaming |
| 0.3.0 | 2026-09-25 | Recording survives reloads and spans every tab of the recording window; Feedback mode (per-site floating button, element picker on a frozen page, review page, MD/ZIP export, FE Feedback build); notes on region and full-page screenshots; MCP server and WebSocket client removed; Markdown export encoding fix; real version in Report Metadata |

### Known Limitations

- **Framework Support**: Only React and Vue; others not auto-detected
- **Response Capture**: Limited to first 1 KB to prevent memory bloat
- **Screenshots**: 5 per Record session; "Full Page" captures the visible viewport, not the whole scrolled page
- **Page freeze (Feedback)**: native `<select>`, cross-origin iframes and Shadow DOM `:hover` rules are not covered (see README)
- **Export Only**: No remote logging or webhook support
- **No automated tests** for capture modules; the guide video script (`scripts/docs-video/`) exercises the main flows end to end

## Phase 1: Stability & Polish

**Focus**: Bug fixes, edge case handling, performance optimization. Not scheduled.

### Tasks

| Priority | Task | Status |
|----------|------|--------|
| High | Fix Vue 2/3 detection edge cases | Pending |
| High | Add comprehensive error logging | Pending |
| High | Performance profiling on slow networks | Pending |
| Medium | Reduce popup latency on large sessions | Pending |
| Medium | Improve CSS selector generation for nested elements | Pending |
| Low | Add unit tests for capture modules | Pending |
| Medium | Network Issues lists `200 OK` entries with an empty URL | Pending |
| Low | Floating Feedback button can cover the Save button of the form near the bottom-right corner | Pending |
| Low | Annotation computed styles include the picker's own `cursor: crosshair` and `__fe_freeze_hover` class | Pending |

### Success Criteria

- [x] Entry cap (2,000 per session) keeps storage under quota
- [x] Recording survives reloads and new tabs in the recording window (0.3.0)
- [ ] Component state capture works for 95%+ of React/Vue apps
- [ ] Export completes in <2 seconds for typical sessions
- [ ] No memory leaks after 1+ hour of recording

## Phase 2: Enhanced Capture

**Focus**: Additional data sources and capture modes

### Features

#### 2.1 Local Storage & Session Storage Capture — Pending
- Auto-snapshot localStorage/sessionStorage on errors
- Include in export for context

**Effort**: 2 days | **Risk**: Low

#### 2.2 API Response Capture — Partly done (0.2.1)
- Done: full request details with headers and a curl command (0.2.1)
- Pending: configurable response body size, JSON parsing with truncation

**Effort**: 3 days | **Risk**: Low

#### 2.3 Screenshot Capture — Done (0.2.0, notes in 0.3.0)
- On-demand full-page and region screenshots, element screenshots on annotations
- Exported as PNG files in the ZIP, linked from `debug-log.md` with their notes

#### 2.4 Custom Field Masking Rules — Pending
- Settings UI for user-defined sensitive patterns
- Store in chrome.storage.local
- Apply to all capture modules

**Effort**: 4 days | **Risk**: Low

#### 2.5 Feedback Mode — Done (0.3.0)
- Per-site floating button, element picker on a frozen page, bug/suggestion items with screenshots
- Review page with edit, delete and MD/ZIP export; separate FE Feedback build

### Success Criteria

- [ ] Local storage snapshots included in exports
- [ ] Response capture covers 95%+ of common APIs
- [x] Screenshot feature integrated and tested
- [ ] Custom masking rules working end-to-end

## Phase 3: Framework Expansion

**Focus**: Support for additional frameworks

### Features

#### 3.1 Angular Support
- Detect Angular using `ng.probe()` or Zone.js inspection
- Capture component tree and change detection info
- Include in component state section

**Effort**: 5 days | **Risk**: Medium

#### 3.2 Svelte Support
- Auto-detect Svelte apps via `__svelte_meta__`
- Walk Svelte component hierarchy
- Capture props and state

**Effort**: 4 days | **Risk**: Low

#### 3.3 Custom Framework Detection
- Plugin system for user-defined framework inspectors
- Example: Ember, Preact, etc.
- Load custom detectors from settings

**Effort**: 7 days | **Risk**: High

#### 3.4 Framework-Specific Debug Info
- React: Fiber tree depth, reconciliation events
- Vue: Lifecycle hooks triggered during session
- Angular: Change detection cycles count

**Effort**: 6 days | **Risk**: Medium

### Success Criteria

- [ ] Angular component detection working reliably
- [ ] Svelte state capture functional
- [ ] Plugin system documented and tested
- [ ] 5+ frameworks supported

## Phase 4: Advanced Export

**Focus**: Enhanced export formats and distribution

### Features

#### 4.1 Multiple Export Formats
- **Markdown** (current)
- **JSON**: Raw structure for programmatic processing
- **HTML**: Self-contained HTML report with styling
- **CSV**: Flat format for spreadsheet analysis

**Effort**: 4 days | **Risk**: Low

#### 4.2 Remote Logging (Optional)
- Webhook support: POST to user-provided endpoint
- Include API key in settings
- Privacy: Fully encrypted transmission

**Effort**: 6 days | **Risk**: Medium

#### 4.3 Cloud Storage Integration
- Optional: Google Drive upload
- Optional: Dropbox integration
- Automatic archival with date-based organization

**Effort**: 8 days | **Risk**: Medium

#### 4.4 Export Templates
- User-customizable Markdown templates
- Predefined templates for common scenarios (bug report, feature audit)
- Template variables: `{url}`, `{timestamp}`, `{browser}`, etc.

**Effort**: 3 days | **Risk**: Low

### Success Criteria

- [ ] JSON and HTML exports working correctly
- [ ] Webhook logging functional and secure
- [ ] Cloud integrations optional but available
- [ ] Template system flexible and documented

## Phase 5: Intelligence & Analysis

**Focus**: AI-assisted debugging and automatic insights

### Features

#### 5.1 Error Pattern Detection
- Auto-categorize errors: network, DOM, type, reference, etc.
- Group similar errors across session
- Summary statistics in export

**Effort**: 5 days | **Risk**: Low

#### 5.2 Performance Metrics
- Web Vitals integration: LCP, FID, CLS
- Long task detection
- Memory snapshots (optional)

**Effort**: 6 days | **Risk**: Medium

#### 5.3 Automatic Insights
- Timeline view with event correlation
- Suggest likely root cause based on error patterns
- Highlight suspicious patterns (e.g., rapid clicks after error)

**Effort**: 8 days | **Risk**: High

#### 5.4 Claude Code Integration — Dropped
- 0.2.x shipped an MCP server that let Claude Code read the log over a local WebSocket
- Removed in 0.3.0: exporting (or copying) the Markdown and handing it to Claude Code is faster and needs no local server; see the decision log

### Success Criteria

- [ ] Error pattern detection 80%+ accurate
- [ ] Performance metrics comprehensive
- [ ] AI insights helpful and non-intrusive
- [ ] Users report faster debugging with insights

## Phase 6: Enterprise Features

**Focus**: Team collaboration and compliance

### Features

#### 6.1 Session Sharing
- Generate shareable links for exported sessions
- Temporary storage on extension server (optional)
- Expiring links with access control

**Effort**: 7 days | **Risk**: Medium

#### 6.2 Team Collaboration
- Shared workspace for debugging sessions
- Comments and annotations on entries
- Assignment to team members

**Effort**: 10 days | **Risk**: High

#### 6.3 Compliance & Audit Logging
- GDPR: Data retention policies + deletion
- HIPAA: Sensitive data handling (if required)
- SOC2: Audit trails for team access

**Effort**: 12 days | **Risk**: High

#### 6.4 Settings & Profiles
- Save/load capture configurations
- Team-wide settings (admin control)
- Per-user overrides

**Effort**: 5 days | **Risk**: Low

### Success Criteria

- [ ] Session sharing functional and secure
- [ ] Team collaboration reducing debug time by 30%+
- [ ] Compliance features audited by security team
- [ ] v1.0.0 ready for enterprise deployment

## Maintenance & Support

### Ongoing Activities

| Activity | Frequency | Owner |
|----------|-----------|-------|
| Bug triage | Weekly | TBD |
| Community support | As needed | TBD |
| Browser compatibility testing | Per Chrome release | TBD |
| Security audits | Quarterly | TBD |
| Performance monitoring | Monthly | TBD |
| Documentation updates | Per release | Docs team |

### Release Cadence

- **Patch (x.y.Z)**: Bug fixes only, ~2-week cycle
- **Minor (x.Y.0)**: Features + bug fixes, ~6-week cycle
- **Major (X.0.0)**: Major refactors, breaking changes, ~6-month cycle

## Metrics & Success

### User Engagement

| Metric | v0.1.0 Target | v0.5.0 Target | v1.0.0 Target |
|--------|--------------|--------------|--------------|
| Weekly active users | 100 | 1,000 | 10,000 |
| Sessions per user | 5 | 20 | 50 |
| Export success rate | 95% | 98% | 99.5% |
| Average session size | 500 entries | 2,000 entries | 5,000 entries |

### Code Quality

| Metric | v0.1.0 | v1.0.0 |
|--------|--------|--------|
| Test coverage | 0% | 70%+ |
| Bug density | TBD | <1 per 1000 LOC |
| Avg response time | <500ms | <200ms |
| Memory usage (recording) | <50 MB | <30 MB |

### Community

| Metric | v0.1.0 | v1.0.0 |
|--------|--------|--------|
| GitHub stars | 0 | 500+ |
| Issue resolution time | TBD | <7 days |
| Feature requests | TBD | Monthly prioritization |
| Documentation completeness | 80% | 95% |

## Risk & Mitigation

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Chrome API changes break extension | High | Medium | Monitor Chrome release notes, early testing |
| Storage quota exceeded in large sessions | Medium | Low | Implement compression, periodic cleanup |
| Performance degrades with complex frameworks | Medium | Medium | Profiling, optimize tree walks, limit depth |
| Race conditions in async flows | High | Low | Comprehensive state machine testing |

### Market Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Similar extensions released | Medium | High | Focus on unique features (Claude integration) |
| User adoption slower than expected | High | Medium | Marketing, case studies, education |
| Framework ecosystem shifts | Medium | Medium | Plan for emerging frameworks early |

### Resource Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| Key team member unavailable | High | Low | Documentation, knowledge sharing |
| Scope creep delays releases | High | High | Strict feature gates, regular backlog reviews |
| Integration dependencies fail | Medium | Low | Early vendor testing, fallback plans |

## Decision Log

### Decisions Made in v0.1.0

1. **Dual Content Script Pattern**: ISOLATED + MAIN world split (approved 2026-03-01)
   - Rationale: Necessary for MV3 compliance
   - Alternative considered: Single script with workarounds (rejected — too fragile)

2. **Markdown Export Format**: Prioritize Claude Code consumption (approved 2026-02-15)
   - Rationale: AI-friendly structured format
   - Alternative considered: JSON (rejected — less human-readable)

3. **No Remote Logging in v0.1.0**: Keep initial scope small (approved 2026-02-20)
   - Rationale: Simplify MVP, add in v0.5.0
   - Alternative considered: Basic webhook (rejected — adds complexity)

### Decisions Made in v0.2.x – v0.3.0

4. **Screenshots as PNG files in a ZIP** (0.2.0)
   - Rationale: keeps `debug-log.md` small and readable; Claude Code opens the images by path
   - Alternative considered: data URLs inside the Markdown (rejected — bloats the file)

5. **Remove the MCP server** (2026-09-24, released in 0.3.0)
   - Rationale: export/copy and hand the Markdown to Claude Code is faster and needs no local server or WebSocket
   - Alternative considered: keep MCP next to export (rejected — two paths to maintain for one job)

6. **Feedback mode as a separate build too** (0.3.0)
   - Rationale: testers who only give UI feedback get no popup, no hotkeys, one icon to toggle the site
   - Constraint: install only one of the two builds per Chrome profile

### Pending Decisions

- [ ] Framework plugin system: Built-in vs. external packages?
- [ ] Cloud storage: Which providers to prioritize (Google Drive, Dropbox, Azure)?
- [ ] Team collaboration: Self-hosted vs. SaaS backend?

## Appendix: Dependencies & Constraints

### Browser Constraints

- **Manifest V3**: No content script access to service worker context
- **CORS**: Network capture limited to same-origin
- **Storage quota**: ~10 MB per extension
- **Content script injection**: Must match `<all_urls>` to work everywhere

### Framework Dependencies

- **React**: Requires dev mode or public Fiber tree access
- **Vue**: Works with Vue 2 & 3, auto-detection may fail in edge cases
- **Angular**: Zone.js presence required for detection

### Performance Constraints

- **Memory**: Mobile browsers may have lower limits
- **CPU**: Older devices struggle with large tree walks
- **Storage**: Quota enforcement by Chrome

## Contact & Questions

- **Product Owner**: TBD
- **Engineering Lead**: TBD
- **Design Lead**: TBD
- **Questions?** Open GitHub issue or email team

---

**Last Updated**: 2026-09-25
