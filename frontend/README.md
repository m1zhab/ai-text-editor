# Frontend Implementation Notes

This file is a local context handoff for the current React/Vite frontend. It is intentionally ignored by git.

## Stack

- Vite + React + TypeScript in `frontend/`
- Tiptap editor with:
  - `@tiptap/react`
  - `@tiptap/starter-kit`
  - `@tiptap/extension-highlight`
  - `@tiptap/extension-text-align`
  - `@tiptap/extension-underline`
- Styling is centralized in `frontend/src/styles.css`.

## Main Files

- `frontend/src/App.tsx`
  - Owns document state, folder state, selected folder, active document, theme, create modal, delete confirmation modal.
  - Persists documents/folders/theme/active document to browser `localStorage`.
  - Routes uploads and new document creation.

- `frontend/src/pages/EditorPage.tsx`
  - Main editor workspace.
  - Left file tree, Tiptap editor area, right AI/files panel.
  - Handles toolbar active states, snapshots, context menus, rename, Save As, PDF placeholder, TXT warning.

- `frontend/src/pages/DocumentGrid.tsx`
  - App grid/home view.
  - Lists documents/assets as cards.
  - Converts saved HTML to readable text previews.

- `frontend/src/components/FilesTab.tsx`
  - Upload/manage list for `.pdf`, `.md`, `.txt`.

- `frontend/src/components/HeaderHighlighter.tsx`
  - Header chip/index UI.
  - Header chips are clickable and jump caret to the section.

- `frontend/src/components/TokenUsageIndicator.tsx`
  - Approximate token usage display using chars / 4.

## Persistence

- Documents are saved in browser localStorage under `ai-text-editor.documents`.
- Active document is saved under `ai-text-editor.activeDocumentId`.
- Folder list is saved under `ai-text-editor.folders`.
- Theme is saved under `ai-text-editor.theme`.
- Snapshots are saved per document under `ai-text-editor.snapshots.<documentId>`.
- TXT warning suppression is saved under `ai-text-editor.suppressTxtWarning`.

Documents currently save in browser storage, not real filesystem storage. Filesystem persistence should go through backend endpoints later.

## Folders

- Root folder is `mnt`.
- Upload folder is `mnt/uploads`.
- All uploaded files go to `mnt/uploads`.
- New documents go into the currently selected folder.
- New folders are created inside the currently selected folder.
- `mnt` and `mnt/uploads` are protected from rename/delete.
- Folder tree supports nested path-based folders.
- Right-click on folders/files opens a context menu.
- Rename is inline with filename/folder validation.
- Delete uses an app-styled confirmation modal.

## Document Types

- `.md`
  - Primary rich editable format.
  - Uses Tiptap rich editor.
  - Saves editor HTML internally for formatting preservation.
  - Save As exports Markdown-ish text converted from saved HTML.

- `.txt`
  - Plain-text import/export format.
  - Loads into the editor but rich toolbar is disabled.
  - Shows a warning modal that formatting will not persist unless saved/exported as `.md`.
  - Autosaves plain text, not HTML formatting.
  - Save As exports plain text.

- `.pdf`
  - Reference-only asset.
  - Clicking a PDF does not open editable Tiptap workspace.
  - Shows a non-editable placeholder explaining PDFs are RAG reference assets only.
  - No Save As option for PDFs.

## Editor Behavior

- Tiptap content is hydrated only when switching documents to avoid cursor jumps.
- Autosave updates parent/localStorage state without resetting editor content.
- Markdown-ish plain text is converted to editor HTML on load.
- Saved rich editor content is HTML.
- Header chips use stable cycling colors instead of changing as text changes.
- Toolbar highlights active formatting and updates on transactions/selection/keyboard shortcuts.
- Left alignment is treated as active by default when center/right are not active.

## Toolbar

- Undo/redo removed.
- Formatting buttons include:
  - Bold
  - Italic
  - Strikethrough
  - Underline
  - Inline code
  - Blockquote
  - Bullet list
  - Ordered list
  - Align left/center/right
  - Heading select
  - Font-size select placeholder
  - Highlight
  - Comment placeholder
- Icons are CSS/code-native, not generated image assets.

## AI Panel

- Persistent right panel has AI and Files tabs.
- Model selector exists.
- Token usage shows:
  - editor tokens
  - reference tokens
  - max tokens
- Selection-aware Summarize/Improve actions call `chatApi.ask`.
- If backend chat fails, local fallback text is inserted.

## Grid

- Cards show file extension, title, plain preview text, folder/date/time.
- Saved HTML is stripped into readable preview text.
- Preview:
  - trims leading blank lines
  - preserves meaningful line breaks
  - truncates at word boundary
  - adds ellipsis when truncated
- Folder/date/time metadata sticks to the bottom of cards.

## Theme

- Light/dark theme toggle in topbar.
- Theme state is saved to localStorage and applied via `body[data-theme]`.

## Known Gaps / Future Work

- Backend filesystem persistence is not implemented.
- Real authenticated private user folders are not implemented.
- RAG extraction/chunking/embedding/retrieval is frontend-ready only; backend behavior is separate.
- PDF viewer is currently a placeholder, not an embedded PDF renderer.
- Markdown export is heuristic, not a full HTML-to-Markdown serializer.
- Font-size select is present but not fully wired to Tiptap marks.
- Comment button is a placeholder status action.
- Chunk-size warning remains due to Tiptap bundle size.

## Verification

Most recent verification command used:

```powershell
cd frontend
npm.cmd run build
```

Build passes. Vite warns that the JS chunk is over 500 KB because of Tiptap.
