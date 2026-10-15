import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const album=source('src/features/album/Album.tsx');
const viewer=source('src/components/MediaViewer.tsx');
const css=source('src/editorial.css');
const primitives=source('src/components/ui.tsx');
const tokens=source('src/design-system.css');

test('story-first view can switch to compact photo wall',()=>{
 assert.match(album,/useState<'stories'\|'grid'>\('stories'\)/);
 assert.match(album,/<SegmentedControl className="album-view-switch" label="相册浏览方式"/);
 assert.match(album,/value={albumView} onChange={setAlbumView}/);
 assert.match(album,/value:'stories' as const/);
 assert.match(album,/value:'grid' as const/);
 assert.match(primitives,/role="group" aria-label={label}/);
 assert.match(primitives,/aria-pressed={value===option.value}/);
 assert.match(album,/className={albumView==='stories'\?'photo-stories':'photo-grid'}/);
 assert.match(album,/className={albumView==='stories'\?'photo-story':'photo-item'}/);
 assert.match(album,/<time dateTime={item.day}>/);
 assert.match(album,/item\.description\.trim\(\)/);
 assert.match(album,/补记这一刻/);
 assert.doesNotMatch(album,/className="photo-description"/);
});
test('story text wraps naturally on iPhone without silent clipping',()=>{
 assert.match(css,/\.photo-story-text \{[^}]*white-space:pre-wrap; overflow-wrap:anywhere/);
 assert.match(css,/\.photo-stories \{ display:grid; grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/\.photo-story \{ display:grid; grid-template-columns:/);
 assert.match(css,/\.photo-story \{ display:block; \}/);
 assert.match(css,/@media\(max-width:800px\) \{\s*\.photo-stories \{ grid-template-columns:minmax\(0,1fr\)/);
 assert.doesNotMatch(css,/\.photo-story-text[^}]*-webkit-line-clamp/);
 assert.match(tokens,/\.bm-segmented button \{[^}]*min-height: var\(--bm-touch-min\)/);
});
test('preview reads the story first, with explicit editor and existing save safety',()=>{
 assert.ok(viewer.indexOf('className="media-story-panel"')<viewer.indexOf('className="media-viewer-toolbar"'));
 assert.match(viewer,/className="media-story-body"/);
 assert.match(viewer,/aria-expanded={editing}/);
 assert.match(viewer,/aria-controls="media-story-edit"/);
 assert.match(viewer,/className="media-viewer-edit" id="media-story-edit" hidden={!editing}/);
 assert.match(viewer,/if\(!editing\|\|draftId!==item.id\)return/);
 assert.match(viewer,/localStorage\.removeItem\('babymemo-draft-media-'/);
 assert.match(viewer,/setEditing\(false\)/);
 assert.match(viewer,/onSave\(\{day,description,requestId,expectedUpdatedAt:version\}\)/);
 assert.match(viewer,/onThumbnailSaved\(id,saved\.updated_at\)/);
 assert.match(css,/\.media-viewer-edit\[hidden\] \{ display:none!important/);
});
