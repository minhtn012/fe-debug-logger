---
title: "Annotation + Screenshot Features"
description: "Add inspect-mode element annotation, 3 screenshot modes, and DOM snapshot capture to FE Debug Logger"
status: pending
priority: P1
effort: 12h
tags: [feature, frontend, chrome-extension]
created: 2026-03-13
---

# Annotation + Screenshot Features

## Overview

Thêm tính năng interactive debugging: FE dev chủ động chỉ vào element trên page, ghi bug note, chụp screenshot, capture DOM snapshot. Output tích hợp vào MD export hiện tại với PNG files riêng.

## Brainstorm Report

[brainstorm-260313-1309-annotation-and-screenshot.md](../reports/brainstorm-260313-1309-annotation-and-screenshot.md)

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | DOM Snapshot Module | Pending | 1.5h | [phase-01](./phase-01-dom-snapshot-module.md) |
| 2 | Annotation Capture Module | Pending | 3h | [phase-02](./phase-02-annotation-capture-module.md) |
| 3 | Screenshot Capture Module | Pending | 3h | [phase-03](./phase-03-screenshot-capture-module.md) |
| 4 | Export Pipeline Update | Pending | 2h | [phase-04](./phase-04-export-pipeline-update.md) |
| 5 | Popup UI + Integration | Pending | 1.5h | [phase-05](./phase-05-popup-ui-integration.md) |
| 6 | Testing + Polish | Pending | 1h | [phase-06](./phase-06-testing-and-polish.md) |

## Dependencies

- Phase 1 → standalone (no deps)
- Phase 2 → depends on Phase 1 (DOM snapshot)
- Phase 3 → depends on Phase 2 (annotation triggers screenshot)
- Phase 4 → depends on Phase 2 + 3 (new entry types + screenshot files)
- Phase 5 → depends on Phase 2 + 3 (annotation/screenshot controls)
- Phase 6 → depends on all above

## Key Architecture Decisions

- **Zero dependencies**: Chỉ Chrome native APIs (captureVisibleTab, Canvas, downloads)
- **Shadow DOM**: Form overlay dùng Shadow DOM để isolate CSS từ page
- **Factory pattern**: Giữ pattern `createXxxCapture(postLog)` nhất quán
- **Subfolder export**: LUÔN tạo subfolder `fe-debug-<timestamp>/debug-log.md` + `screenshots/`
- **MAIN world**: Annotation + DOM snapshot chạy trong MAIN world (cần DOM access)
- **Background**: Screenshot capture chạy qua background (cần `captureVisibleTab`)
- **Keyboard shortcut**: `Ctrl+Shift+A` bật inspect mode qua `chrome.commands` API
- **Screenshot limit**: Max 5 screenshots/session (~2.5-5MB). Warn user khi đạt limit.
- **Navigation blocking**: `preventDefault()` tất cả clicks trong inspect mode
- **Extended DOM capture**: ~20 computed styles (visibility + layout + box model + typography) + all data-*/id/aria-label attributes
- **Parent chain 7 levels**: Kèm identifiers cho Claude grep source code
- **Screenshot padding**: Proportional context padding (30%, min 20px, max 100px) cho element crops
- **Temporal linking**: Annotations auto-link nearby console errors/actions ±5s
- **Report metadata**: Structured metadata block ở đầu MD cho AI parsing

## New Files

| File | Purpose | LOC est |
|------|---------|---------|
| `capture/dom-snapshot-capture.js` | Capture outerHTML + computed styles | ~80 |
| `capture/annotation-capture.js` | Inspect mode + overlay form + data | ~180 |
| `capture/screenshot-capture.js` | 3 screenshot modes coordination | ~120 |
| `annotation-overlay.css` | Shadow DOM styles cho form | ~80 |

## Modified Files

| File | Changes |
|------|---------|
| `manifest.json` | Thêm MAIN world scripts, `tabs` permission |
| `content-script-main.js` | Integrate annotation + DOM snapshot modules |
| `content-script.js` | Relay annotation + screenshot messages |
| `background.js` | Handle annotation/screenshot messages, captureVisibleTab |
| `offscreen.js` | Canvas crop logic cho element/region screenshots |
| `formatter/markdown-formatter.js` | Thêm Annotations section |
| `popup.html/js/css` | Annotate button, screenshot controls |
