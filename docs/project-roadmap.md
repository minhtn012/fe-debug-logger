# Project Roadmap

## Current Status

**Version**: 0.1.0 (MVP - Minimum Viable Product)
**Release Date**: 2026-03-13
**Status**: Initial Release

### v0.1.0 Features

- [x] Console capture (errors, warnings, stack traces)
- [x] User action tracking (clicks, form inputs, navigation)
- [x] Network monitoring (HTTP errors, slow requests)
- [x] React/Vue component state snapshots
- [x] Markdown export with structured formatting
- [x] Popup UI with Start/Stop/Export/Clear controls
- [x] Selective capture categories (4 toggles)
- [x] Sensitive field masking (passwords, tokens)
- [x] Session metadata (URL, time, browser, viewport)

### Known Limitations

- **Vue 3 Detection**: Improved in v0.1.0 but may miss some edge cases
- **Framework Support**: Only React and Vue; others not auto-detected
- **Response Capture**: Limited to first 1 KB to prevent memory bloat
- **Storage**: Limited to ~10 MB per session (Chrome quota)
- **Export Only**: No remote logging or webhook support
- **Manual Cleanup**: Users must manually clear entries between sessions

## Phase 1: Stability & Polish (v0.2.0, Q2 2026)

**Focus**: Bug fixes, edge case handling, performance optimization

### Tasks

| Priority | Task | Owner | Status | ETA |
|----------|------|-------|--------|-----|
| High | Fix Vue 2/3 detection edge cases | TBD | Pending | 2026-04-15 |
| High | Add comprehensive error logging | TBD | Pending | 2026-04-10 |
| High | Performance profiling on slow networks | TBD | Pending | 2026-04-20 |
| Medium | Reduce popup latency on large sessions | TBD | Pending | 2026-04-25 |
| Medium | Improve CSS selector generation for nested elements | TBD | Pending | 2026-05-01 |
| Low | Add unit tests for capture modules | TBD | Pending | 2026-05-10 |

### Success Criteria

- [x] Zero unresolved bugs in v0.1.0
- [ ] Handles 10K+ entries without performance degradation
- [ ] Component state capture works for 95%+ of React/Vue apps
- [ ] Export completes in <2 seconds for typical sessions
- [ ] No memory leaks after 1+ hour of recording

## Phase 2: Enhanced Capture (v0.3.0, Q3 2026)

**Focus**: Additional data sources and capture modes

### Features

#### 2.1 Local Storage & Session Storage Capture
- Auto-snapshot localStorage/sessionStorage on errors
- Include in export for context

**Effort**: 2 days | **Risk**: Low

#### 2.2 API Response Capture
- Increase response body capture to 5 KB (configurable)
- Parse JSON responses with truncation
- Include response headers in export

**Effort**: 3 days | **Risk**: Low

#### 2.3 Screenshot Capture (optional)
- Capture page screenshot on error or on-demand
- Export as embedded data URL in Markdown
- Configurable: enable/disable

**Effort**: 5 days | **Risk**: Medium

#### 2.4 Custom Field Masking Rules
- Settings UI for user-defined sensitive patterns
- Store in chrome.storage.local
- Apply to all capture modules

**Effort**: 4 days | **Risk**: Low

### Success Criteria

- [ ] Local storage snapshots included in exports
- [ ] Response capture covers 95%+ of common APIs
- [ ] Screenshot feature integrated and tested
- [ ] Custom masking rules working end-to-end

## Phase 3: Framework Expansion (v0.4.0, Q4 2026)

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
- [ ] 5+ frameworks supported by v0.4.0 release

## Phase 4: Advanced Export (v0.5.0, Q1 2027)

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

## Phase 5: Intelligence & Analysis (v0.6.0, 2027)

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

#### 5.4 Claude Code Integration (If Approved)
- Direct export to Claude Code via API
- Automatic debugging session initiation
- Structured context passing

**Effort**: 10 days | **Risk**: High (API dependency)

### Success Criteria

- [ ] Error pattern detection 80%+ accurate
- [ ] Performance metrics comprehensive
- [ ] AI insights helpful and non-intrusive
- [ ] Users report faster debugging with insights

## Phase 6: Enterprise Features (v1.0.0, 2027)

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

### Pending Decisions

- [ ] Framework plugin system: Built-in vs. external packages?
- [ ] Cloud storage: Which providers to prioritize (Google Drive, Dropbox, Azure)?
- [ ] Team collaboration: Self-hosted vs. SaaS backend?
- [ ] Claude integration: API approach, authentication, permissions?

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

**Last Updated**: 2026-03-13
**Next Review**: 2026-04-10
