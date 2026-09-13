import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowUp, Check, ChevronDown, Circle, CircleHelp, Disc3, FileVideo, FolderOpen, GripVertical, History, Keyboard, Library, ListMusic, LoaderCircle, Maximize, MicVocal, MonitorUp, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, Save, Search, SkipForward, SlidersHorizontal, Trash2, Upload, Volume2, VolumeX, X } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { AnimatedCollapse } from './AnimatedCollapse';
import { ResizableLayout } from './ResizableLayout';
import { Controller, type Settings } from './controller';
import { compareSongOrder, songGroupKey, orderedAlbums } from '../shared/types';
import type { PublicSong } from '../shared/types';

const time = (s: number) => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;
export function App({ controller: c }: { controller: Controller }) {
  useSyncExternalStore(c.subscribe, c.snapshot);
  const video = useRef<HTMLVideoElement>(null), stage = useRef<HTMLDivElement>(null);
  const importDialog = useRef<HTMLDialogElement>(null), editDialog = useRef<HTMLDialogElement>(null), deleteDialog = useRef<HTMLDialogElement>(null), settingsDetails = useRef<HTMLDetailsElement>(null);
  const tipsContainer = useRef<HTMLDivElement>(null);
  const [tipsOpen, setTipsOpen] = useState(false);
  const tipsOpenRef = useRef(tipsOpen);
  tipsOpenRef.current = tipsOpen;
  const importFiles = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [fileDropAlbum, setFileDropAlbum] = useState<string | null>(null);
  const [tab, setTab] = useState<'library' | 'queue' | 'history'>('library'), [query, setQuery] = useState('');
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(() => new Set());
  const [draggedSong, setDraggedSong] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [draggedAlbum, setDraggedAlbum] = useState<string | null>(null);
  const [albumDropTarget, setAlbumDropTarget] = useState<{ name: string; after: boolean } | null>(null);
  const albumDragType = 'application/x-karaoke-album';
  const songDragType = 'application/x-karaoke-song';
  useEffect(() => {
    if (query.trim()) setExpandedAlbums(new Set(c.songs.filter(song => [song.title, song.artist, song.album, song.version].join(' ').toLowerCase().includes(query.trim().toLowerCase())).map(song => song.album)));
  }, [query, c.songs]);
  const [editing, setEditing] = useState<PublicSong | null>(null), [pendingDelete, setPendingDelete] = useState<PublicSong | null>(null);
  const [importing, setImporting] = useState(false), [replacing, setReplacing] = useState(false), [deleting, setDeleting] = useState(false), [scanning, setScanning] = useState(false);
  const run = (fn: () => unknown) => { void Promise.resolve().then(fn).catch(e => c.notice(e.message)); };
  const runLibrary = (fn: () => unknown) => { void Promise.resolve().then(fn).catch(e => c.libraryNotice(e.message)); };
  function openImport(files?: File[], album?: string) {
    if (importing) { c.libraryNotice('正在导入，请稍候'); return; }
    importFiles.current?.form?.reset();
    if (files) {
      const mp4s = files.filter(file => /\.mp4$/i.test(file.name));
      if (!mp4s.length) { c.libraryNotice('请拖入 MP4 视频文件'); return; }
      if (mp4s.length > 100) { c.libraryNotice('一次最多导入 100 个 MP4'); return; }
      const transfer = new DataTransfer(); mp4s.forEach(file => transfer.items.add(file));
      importFiles.current!.files = transfer.files;
      if (mp4s.length !== files.length) c.libraryNotice(`已选择 ${mp4s.length} 个 MP4，其余文件已忽略`);
    }
    if (album !== undefined) {
      // Use the saved song order of the whole album, even while search hides its first song.
      const first = c.songs.filter(song => song.album === album).sort(compareSongOrder)[0];
      if (first) {
        for (const key of ['album', 'artist', 'version'] as const) {
          const input = importFiles.current?.form?.elements.namedItem(key);
          if (input instanceof HTMLInputElement) input.value = first[key];
        }
      }
    }
    importDialog.current?.showModal();
  }
  const dropAlbum = (target: EventTarget) => target instanceof Element ? target.closest<HTMLElement>('.library-album')?.dataset.album : undefined;
  const fullscreen = () => { if (document.fullscreenElement) run(() => document.exitFullscreen()); else run(() => stage.current?.requestFullscreen()); };
  useEffect(() => {
    c.mount(video.current!);
    const keyboard = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,textarea,select,[contenteditable=true]') || document.querySelector('dialog[open]')) return;
      if (['Space', 'ArrowLeft', 'ArrowRight', 'KeyV', 'KeyF'].includes(event.code)) event.preventDefault();
      if (event.code === 'Space') run(() => c.player.playing ? c.pause() : c.play());
      if (event.code === 'KeyV') c.toggleGuide();
      if (event.code === 'KeyF') fullscreen();
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') c.seek(c.player.position() + (event.code === 'ArrowLeft' ? -5 : 5));
    };
    document.addEventListener('keydown', keyboard);
    const preventFileNavigation = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventFileNavigation); window.addEventListener('drop', preventFileNavigation);
    const handlePointerDown = (event: PointerEvent) => {
      if (settingsDetails.current?.open && !settingsDetails.current.contains(event.target as Node)) {
        settingsDetails.current.open = false;
      }
      if (tipsOpenRef.current && tipsContainer.current && !tipsContainer.current.contains(event.target as Node)) {
        setTipsOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (settingsDetails.current?.open) settingsDetails.current.open = false;
        if (tipsOpenRef.current) setTipsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    const unload = () => c.destroy(); window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('dragover', preventFileNavigation);
      window.removeEventListener('drop', preventFileNavigation);
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('beforeunload', unload);
      c.destroy();
    };
  }, [c]);
  useEffect(() => { if (editing) editDialog.current?.showModal(); }, [editing]);
  useEffect(() => { if (pendingDelete) deleteDialog.current?.showModal(); }, [pendingDelete]);
  const matches = (song: PublicSong) => [song.title, song.artist, song.album, song.version].join(' ').toLowerCase().includes(query.trim().toLowerCase());
  const groups = new Map<string, PublicSong[]>();
  for (const song of c.songs.filter(matches).sort(compareSongOrder)) {
    const key = songGroupKey(song); groups.set(key, [...(groups.get(key) || []), song]);
  }
  const groupedAlbums = new Map<string, PublicSong[][]>();
  for (const group of groups.values()) groupedAlbums.set(group[0].album, [...(groupedAlbums.get(group[0].album) || []), group]);
  function version(song: PublicSong, index?: number, sortable = false) {
    const editHint = song.metadata_matches?.length ? `编辑歌曲 · ${song.metadata_matches.length} 个匹配候选` : '编辑歌曲';
    const positions = c.queue.flatMap((id, index) => id === song.id ? [index + 1] : []);
    const queued = positions.length > 0;
    return <div className="version" key={`${song.id}-${index ?? ''}`}>
      {sortable ? <Button type="button" variant="ghost" size="sm" className="song-drag-handle" draggable={!c.reordering} disabled={c.reordering} title="拖动排序 · ↑↓调整顺序" aria-label={`调整歌曲顺序：${song.title}`}
        onDragStart={event => { event.dataTransfer.setData(songDragType, song.id); event.dataTransfer.effectAllowed = 'move'; setDraggedSong(song.id); const card = event.currentTarget.closest('.song'); if (card) event.dataTransfer.setDragImage(card, 18, 20); }}
        onDragEnd={() => { setDraggedSong(null); setDropTarget(null); }}
        onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'Space'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); if (event.code !== 'Space') runLibrary(() => c.moveLibrarySong(song.id, event.code === 'ArrowUp' ? -1 : 1)); } }}><GripVertical aria-hidden="true" /></Button> : <div className="disc"><Disc3 aria-hidden="true" /></div>}
      <div className="song-heading"><span className="song-title" title={song.title}>{song.title}</span></div>
      <div className="song-actions">
        {index === undefined ? <div className="song-request">
          <Button variant="outline" size="sm" className={`queue-request${queued ? ' is-queued' : ''}`} aria-label={queued ? `已经点歌，排位 ${positions.join('、')}，再次点歌` : '点歌'} title={queued ? `待唱排位：${positions.join('、')}；点击再次点歌` : '加入待唱'} onClick={() => c.add(song.id)}>
            {queued ? <><span className="queue-request-label"><span className="queue-request-idle"><Check aria-hidden="true" />已经点歌</span><span className="queue-request-again"><Plus aria-hidden="true" />再次点歌</span></span></> : <><Plus aria-hidden="true" />点歌</>}
          </Button>
          {queued && <span className="queue-positions" aria-label={`待唱排位：${positions.join('、')}`}>{positions.map(position => <span className="queue-position" key={position}>{position}</span>)}</span>}
        </div> : <><Button variant="outline" size="sm" disabled={index === 0} aria-label="上移" title="上移" onClick={() => c.moveUp(index)}><ArrowUp aria-hidden="true" /></Button><Button variant="ghost" size="sm" aria-label="移除" title="移除" onClick={() => c.remove(index)}><Trash2 aria-hidden="true" /><span className="remove-label">移除</span></Button></>}
      </div>
      <div className="song-detail"><span className="song-artist" title={song.artist || song.album}>{song.artist || song.album}</span>{!song.playable ? <span className="warning">{song.missing ? '文件缺失' : '需确认音轨'}</span> : song.vocals === null ? <span className="song-status">单轨 · 无纯人声</span> : null}<span className="version-badge" title={song.version}>{song.version}</span><div className="song-secondary-actions">
        <Button variant="ghost" size="sm" className="song-play" title="立即播放" aria-label="立即播放" disabled={!song.playable} onClick={() => run(() => c.loadSong(song.id, index))}><Play aria-hidden="true" /></Button>
        <Button variant="ghost" size="sm" className="edit" aria-label={editHint} title={editHint} onClick={() => setEditing(song)}><Pencil aria-hidden="true" /></Button>
      </div></div>
    </div>;
  }
  function card(song: PublicSong, versions: PublicSong[], index?: number, sortable = false) {
    return <article className={`song${draggedSong && versions.some(v => v.id === draggedSong) ? ' song-dragging' : ''}${dropTarget?.id === song.id ? dropTarget.after ? ' drop-after' : ' drop-before' : ''}`} data-song-id={song.id} key={`${song.id}-${index ?? ''}`}
      onDragOver={event => {
        if (!sortable || !event.dataTransfer.types.includes(songDragType) || c.reordering) return;
        const source = c.songs.find(s => s.id === draggedSong);
        if (!source || source.album !== song.album || songGroupKey(source) === songGroupKey(song)) { event.dataTransfer.dropEffect = 'none'; return; }
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
        const rect = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: song.id, after: event.clientY > rect.top + rect.height / 2 });
      }}
      onDrop={event => {
        if (!sortable || !event.dataTransfer.types.includes(songDragType)) return;
        event.preventDefault(); event.stopPropagation();
        const sourceId = event.dataTransfer.getData(songDragType), rect = event.currentTarget.getBoundingClientRect();
        setDraggedSong(null); setDropTarget(null);
        runLibrary(() => c.reorderSong(sourceId, song.id, event.clientY > rect.top + rect.height / 2));
      }}><div className="versions">{versions.map((s, i) => version(s, index, sortable && i === 0))}</div></article>;
  }
  const upcoming = c.upcomingSong;
  const upcomingLabel = c.autoStartSeconds > 0 ? `${c.autoStartSeconds} 秒后开始播放` : upcoming ? `下一首：${upcoming.title}` : c.status;
  const upcomingDetails = upcoming ? ['下一首', upcoming.title, upcoming.artist, upcoming.version].filter(Boolean).join(' · ') : c.status;
  const notice = <div id="notice" role="status" style={{ display: c.message ? 'block' : 'none' }}>{c.message}</div>;
  const entries = tab === 'queue' ? c.queue.map((id, index) => ({ id, index })) : c.history.map((h, index) => ({ id: h.id, index }));
  const rows = entries.flatMap(entry => { const song = c.songs.find(s => s.id === entry.id); return song && matches(song) ? [<div key={entry.index}>{card(song, [song], tab === 'queue' ? entry.index : undefined)}</div>] : []; });
  function fader(key: keyof Settings, label: string, min = 0, max = 1, step = .01) {
    const val = c.settings[key];
    const pct = max > min ? Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100)) : 0;
    return <label className="fader">{label}<input id={key} aria-label={label} type="range" min={min} max={max} step={step} value={c.settings[key]} style={{ '--progress': `${pct.toFixed(1)}%` } as React.CSSProperties} disabled={key === 'vocals' && (c.loading || !c.player.buffers[1])} onInput={e => c.setLevel(key, Number(e.currentTarget.value))} /><output id={`${key}-value`}>{key === 'delay' ? `${c.settings[key]} ms` : `${Math.round(c.settings[key] * 100)}%`}</output></label>;
  }
  return <><header><a className="brand" href="/"><img className="app-icon" src="/icons/app.svg" width="30" height="30" alt="" aria-hidden="true" /> <b>Auto Karaoke Player</b></a><div className="spacer" /><Button id="display" variant="outline" onClick={() => c.openDisplay()}><MonitorUp aria-hidden="true" />观众窗口</Button><Button id="import-open" className="primary" onClick={() => openImport()}><Plus aria-hidden="true" />导入 MP4</Button><details className="settings-popover" ref={settingsDetails}><summary className="settings-trigger" title="曲库与投屏设置" aria-label="曲库与投屏设置"><SlidersHorizontal aria-hidden="true" /><span>设置</span></summary><div className="settings-panel"><div className="settings-header"><div className="settings-title"><SlidersHorizontal aria-hidden="true" /><strong>曲库与投屏设置</strong></div><button type="button" className="settings-close" onClick={() => { if (settingsDetails.current) settingsDetails.current.open = false; }} aria-label="关闭设置"><X aria-hidden="true" /></button></div><div className="settings-body"><div className="settings-section"><span className="settings-section-title">当前曲库路径</span><p id="folder" title={c.folder}>{c.folder}</p><p className="settings-hint">拷贝整个曲库文件夹即可搬家到其他设备。队列、历史和音量保存在当前播放器。</p>{window.desktop && <Button variant="outline" size="sm" onClick={() => run(() => window.desktop!.chooseLibrary())}><FolderOpen aria-hidden="true" />选择曲库文件夹</Button>}</div><div className="settings-section"><span className="settings-section-title">画面延迟补偿</span>{fader('delay', '画面延迟', -300, 300, 10)}<p className="settings-hint">若电视或投影仪处理较慢，可在此微调延迟，正值画面落后声音。</p></div><div className="settings-section"><span className="settings-section-title">HDMI 投屏指引</span><p className="settings-hint">电脑连接电视/投影仪后，在系统设置中选择“扩展屏幕”，点击顶栏“观众窗口”拖到电视后全屏，系统音频输出选择 HDMI。</p></div></div></div></details><div className="tips-menu-container" ref={tipsContainer}><Button id="tips-trigger" variant="ghost" size="sm" className={`tips-trigger${tipsOpen ? ' active' : ''}`} onClick={() => setTipsOpen(v => !v)} title="快捷键与使用技巧" aria-label="快捷键与使用技巧"><CircleHelp aria-hidden="true" /></Button>{tipsOpen && <div className="settings-panel tips-panel"><div className="settings-header"><div className="settings-title"><Keyboard aria-hidden="true" /><strong>快捷键与操作技巧</strong></div><button type="button" className="settings-close" onClick={() => setTipsOpen(false)} aria-label="关闭提示"><X aria-hidden="true" /></button></div><div className="settings-body tips-body"><div className="shortcut-list"><div className="shortcut-row"><div className="shortcut-keys"><kbd>Space</kbd></div><div className="shortcut-desc">播放 / 暂停</div></div><div className="shortcut-row"><div className="shortcut-keys"><kbd>←</kbd> <kbd>→</kbd></div><div className="shortcut-desc">快退 / 快进 5 秒</div></div><div className="shortcut-row"><div className="shortcut-keys"><kbd>V</kbd></div><div className="shortcut-desc">切换伴奏 / 导唱</div></div><div className="shortcut-row"><div className="shortcut-keys"><kbd>F</kbd></div><div className="shortcut-desc">视频舞台全屏</div></div><div className="shortcut-row"><div className="shortcut-keys"><kbd>Esc</kbd></div><div className="shortcut-desc">退出全屏 / 关闭浮层</div></div></div><div className="settings-section" style={{ marginTop: 14, paddingTop: 12 }}><span className="settings-section-title">点歌与排序技巧</span><p className="settings-hint">曲库中点击“点歌”加入待唱列表；拖动专辑左侧唱片把手或使用 <kbd>↑</kbd> <kbd>↓</kbd> 键可快速调整播放优先级。</p></div></div></div>}</div></header>
    <ResizableLayout><section className="desk"><div id="stage" ref={stage}><video id="video" ref={video} muted playsInline preload="metadata" />{upcoming && <div id="next-song" className="next-song-overlay" title={upcomingDetails}>下一首：{upcoming.title}</div>}{!c.current && <div id="empty"><div className="empty-vinyl-decor" aria-hidden="true"><Disc3 className="vinyl-icon" /></div><span className="eyebrow">YOUR PRIVATE STAGE</span><h1>今晚，唱哪一首？</h1><p>从右侧曲库点歌，或导入你的卡拉 OK 视频。</p></div>}<Button id="fullscreen" variant="ghost" title="画面全屏" aria-label="画面全屏" onClick={fullscreen}><Maximize aria-hidden="true" /></Button></div>
      <div className="desk-controls">
        <div className="now"><div><h2 id="now-title">{c.current?.title || '等待点歌'}</h2><p id="now-meta">{c.current ? [c.current.artist, c.current.album, c.current.version].filter(Boolean).join(' · ') : '伴奏与纯人声 · 独立混音'}</p></div><span id="state" title={upcomingDetails} aria-live="polite" aria-atomic="true">{upcomingLabel}</span></div>
        <div className="timeline"><span id="elapsed">{time(c.player.position())}</span><input id="seek" aria-label="播放进度" type="range" min="0" max={c.player.duration || 1} step=".01" value={c.player.position()} style={{ '--progress': `${(c.player.duration > 0 ? Math.min(100, Math.max(0, (c.player.position() / c.player.duration) * 100)) : 0).toFixed(2)}%` } as React.CSSProperties} disabled={c.loading || !c.player.buffers.length} onInput={e => c.seek(Number(e.currentTarget.value))} /><span id="duration">{time(c.player.duration)}</span></div>
        <div className="transport">
          <div className="transport-playback">
            <Button id="restart" variant="outline" size="sm" title="重新开始" aria-label="重新开始" onClick={() => c.seek(0)}><RotateCcw aria-hidden="true" /></Button>
            <Button id="play" disabled={c.loading} onClick={() => run(() => c.player.playing ? c.pause() : c.play())}>
              {c.loading ? <LoaderCircle className="spin" aria-hidden="true" /> : c.player.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              {c.player.playing ? '暂停' : '播放'}
            </Button>
            <Button id="next" variant="outline" size="sm" onClick={() => run(() => c.next())}><SkipForward aria-hidden="true" />切歌</Button>
          </div>
          <div className="transport-divider" aria-hidden="true" />
          <div className="transport-stems">
            {fader('backing', '伴奏')}
            {fader('vocals', '纯人声')}
            <Button id="guide" variant="outline" size="sm" disabled={c.loading || !c.player.buffers[1]} onClick={() => c.toggleGuide()} title="切换导唱 (V)">
              <span className={`led-dot${c.settings.vocals > 0 ? ' active' : ''}`} aria-hidden="true" />
              <MicVocal aria-hidden="true" />
              {c.settings.vocals > 0 ? '导唱开' : '导唱关'}<kbd>V</kbd>
            </Button>
          </div>
          <div className="spacer" />
          <div className="transport-volume">
            <Button id="mute" variant="ghost" size="sm" onClick={() => c.toggleMute()} title={c.muted ? '取消静音' : '静音'}>
              {c.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            </Button>
            <input id="master" aria-label="总音量" type="range" min="0" max="1" step=".01" value={c.settings.master} style={{ '--progress': `${Math.round(c.settings.master * 100)}%` } as React.CSSProperties} onInput={e => c.setLevel('master', Number(e.currentTarget.value))} />
          </div>
        </div>
      </div>
    </section><section className={`collection ${dragging ? 'dragging' : ''}`} aria-label="曲库与拖拽导入"
      onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = importing ? 'none' : 'copy'; setFileDropAlbum(dropAlbum(event.target) ?? null); } }}
      onDragLeave={event => { if (event.dataTransfer.types.includes('Files')) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) { setDragging(false); setFileDropAlbum(null); } } }}
      onDrop={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); setFileDropAlbum(null); openImport(Array.from(event.dataTransfer.files), dropAlbum(event.target)); }}>
      {dragging && <div className="drop-overlay"><FileVideo aria-hidden="true" /><strong>{fileDropAlbum !== null ? `导入到「${fileDropAlbum}」` : '松开鼠标，导入 MP4'}</strong><span>{fileDropAlbum !== null ? '复用专辑名及第一首歌的歌手、版本 · 导入前可修改' : '拖到专辑上复用专辑信息 · 支持多个视频'}</span></div>}
      <nav><div className="tab-group">{(['library', 'queue', 'history'] as const).map(t => <Button key={t} variant="ghost" className={`tab ${tab === t ? 'active' : ''}`} data-tab={t} onClick={() => setTab(t)}>{t === 'library' ? <><Library aria-hidden="true" />曲库 <span id="library-count">{c.songs.length}</span></> : t === 'queue' ? <><ListMusic aria-hidden="true" />待唱 <span id="queue-count">{c.queue.length}</span></> : <><History aria-hidden="true" />最近唱过</>}</Button>)}</div><div className="spacer" /><Button id="scan" variant="ghost" title="扫描曲库文件夹" aria-label="扫描曲库文件夹" disabled={scanning} onClick={() => runLibrary(async () => { setScanning(true); try { await c.refresh(true); } finally { setScanning(false); } })}><RefreshCw className={scanning ? "spin" : undefined} aria-hidden="true" /></Button></nav>
      {tab === 'library' && <div className="drop-hint"><Upload aria-hidden="true" />把 MP4 拖到这里导入</div>}
      <div className="search"><Search aria-hidden="true" /><Input id="search" placeholder="搜索歌曲、专辑、歌手…" aria-label="搜索曲库" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <div id="list">{tab === 'library' ? orderedAlbums(c.songs, c.albumOrder).filter(name => groupedAlbums.has(name)).map(name => {
        const albumGroups = groupedAlbums.get(name)!;
        const panelId = 'album-content-' + encodeURIComponent(name);
        const expanded = expandedAlbums.has(name), versionCount = albumGroups.reduce((count, group) => count + group.length, 0);
        const artists = [...new Set(albumGroups.flat().map(s => s.artist).filter(Boolean))].join(' · ');
        return <section className={`library-album${fileDropAlbum === name ? ' file-drop-target' : ''}${draggedAlbum === name ? ' album-dragging' : ''}${albumDropTarget?.name === name ? albumDropTarget.after ? ' drop-after' : ' drop-before' : ''}`} key={name} data-album={name}
          onDragOver={event => {
            if (!event.dataTransfer.types.includes(albumDragType) || c.reordering || draggedAlbum === null || draggedAlbum === name) return;
            event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move';
            const rect = event.currentTarget.getBoundingClientRect(); setAlbumDropTarget({ name, after: event.clientY > rect.top + rect.height / 2 });
          }}
          onDrop={event => {
            if (!event.dataTransfer.types.includes(albumDragType)) return;
            event.preventDefault(); event.stopPropagation();
            const source = event.dataTransfer.getData(albumDragType), rect = event.currentTarget.getBoundingClientRect();
            setDraggedAlbum(null); setAlbumDropTarget(null);
            runLibrary(() => c.reorderAlbum(source, name, event.clientY > rect.top + rect.height / 2));
          }}>
          <div className="album-header">
          <button type="button" className="album-disc album-drag-handle" draggable={!c.reordering} disabled={c.reordering} title="拖动专辑排序 · ↑↓调整顺序" aria-label={`调整专辑顺序：${name}`}
            onDragStart={event => { event.dataTransfer.setData(albumDragType, name); event.dataTransfer.effectAllowed = 'move'; setDraggedAlbum(name); const header = event.currentTarget.closest('.album-header'); if (header) event.dataTransfer.setDragImage(header, 20, 20); }}
            onDragEnd={() => { setDraggedAlbum(null); setAlbumDropTarget(null); }}
            onKeyDown={event => { if (['ArrowUp', 'ArrowDown', 'Space'].includes(event.code)) { event.preventDefault(); event.stopPropagation(); if (event.code !== 'Space') runLibrary(() => c.moveAlbum(name, event.code === 'ArrowUp' ? -1 : 1)); } }}>
            <Disc3 className="album-disc-icon" aria-hidden="true" /><GripVertical className="album-grip-icon" aria-hidden="true" />
          </button>
          <button type="button" className="album-toggle" aria-expanded={expanded} aria-controls={panelId} onKeyDown={event => { if (['Space', 'Enter'].includes(event.code)) event.stopPropagation(); }} onClick={() => setExpandedAlbums(previous => { const next = new Set(previous); if (next.has(name)) next.delete(name); else next.add(name); return next; })}>
            <span className="album-info"><strong>{name}</strong><small>{artists || '本地专辑'}</small></span><span className="album-count">{albumGroups.length} 首{versionCount > albumGroups.length ? ` · ${versionCount} 个版本` : ''}</span><ChevronDown className={expanded ? 'expanded' : undefined} aria-hidden="true" />
          </button>
          </div>
          <AnimatedCollapse open={expanded} id={panelId}><div className="album-songs">{albumGroups.map(group => card(group[0], group, undefined, true))}</div></AnimatedCollapse>
        </section>;
      }) : rows}{(tab === 'library' ? groups.size === 0 : rows.length === 0) && <p className="empty-list">{query ? '没有匹配的歌曲。' : tab === 'library' ? '拖入 MP4，或点击“导入 MP4”开始建立曲库。' : tab === 'queue' ? '待唱列表为空，去曲库挑一首吧。' : '这里会留下你唱过的歌。'}</p>}</div>
    {c.noticeScope === 'library' && notice}</section></ResizableLayout>{c.noticeScope === 'app' && notice}
    <dialog id="import-dialog" ref={importDialog}><form id="import-form" onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget; setImporting(true);
      runLibrary(async () => { try { const data = new FormData(form); if (data.getAll('files').length > 1) data.delete('title'); const result = await c.api<{ songs: PublicSong[]; errors: string[] }>('/api/import', 'POST', data); await c.refresh(); if (result.errors.length) c.libraryNotice(result.errors.join('；')); else { c.libraryNotice(`已导入 ${result.songs.length} 个版本`); importDialog.current?.close(); form.reset(); } } finally { setImporting(false); } });
    }}><h2>把歌曲带进唱片室</h2><p>已选择的视频会复制到曲库。留空的信息将根据视频指纹自动匹配；首次导入可手动填写。</p><label>MP4 文件<Input ref={importFiles} name="files" type="file" accept=".mp4,video/mp4" multiple required /></label><div className="fields"><label>专辑<Input name="album" placeholder="留空自动匹配，或填写专辑" /></label><label>歌手<Input name="artist" /></label></div><label>版本<Input name="version" placeholder="留空自动匹配，或填写 Live / 专辑版" /></label><label>曲名（多文件导入时使用各自文件名）<Input name="title" placeholder="留空使用文件名；导入后可修改" /></label><p>同一专辑下曲名、歌手相同的条目会合并展示为不同版本。</p><footer><Button type="button" variant="outline" onClick={() => importDialog.current?.close()}><X aria-hidden="true" />取消</Button><Button className="primary" id="import-submit" disabled={importing}>{importing ? <LoaderCircle className="spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}{importing ? '正在复制、计算指纹与匹配…' : '导入曲库'}</Button></footer></form></dialog>
    <dialog id="edit-dialog" ref={editDialog} onClose={() => setEditing(null)}>{editing && <form id="edit-form" key={editing.id} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget); const body = Object.fromEntries(['title', 'artist', 'album', 'version'].map(key => [key, data.get(key)]));
      runLibrary(async () => { await c.api('/api/songs/' + editing.id, 'PATCH', { ...body, mapping: { instrumental: data.get('instrumental') === '' ? null : Number(data.get('instrumental')), vocals: data.get('vocals') === '' ? null : Number(data.get('vocals')) } }); editDialog.current?.close(); await c.refresh(); c.libraryNotice('已保存到曲库；音轨修改在下次播放生效'); });
    }}><h2>歌曲与版本</h2>{editing.metadata_matches?.length ? <div className="metadata-candidates"><h3>找到已保存的歌曲信息</h3><p>相同文件名或曲名可能属于不同版本，请确认后采用。</p>{editing.metadata_matches.map((match, index) => <div className="metadata-candidate" key={index}><div><small>{match.method === 'sha256' ? '相同视频指纹' : match.method === 'filename' ? '相同文件名 · 需确认' : '相同歌曲名 · 需确认'}</small><strong>{match.record.title}</strong><span>{[match.record.artist, match.record.album, match.record.version].filter(Boolean).join(' · ')}</span></div><Button type="button" size="sm" variant="outline" onClick={() => runLibrary(async () => { await c.api('/api/songs/' + editing.id + '/match', 'POST', match.record); editDialog.current?.close(); await c.refresh(); c.libraryNotice('已采用歌曲信息；音轨对应关系仅在视频指纹相同时恢复'); })}><Check aria-hidden="true" />采用此记录</Button></div>)}</div> : null}
      <p className="fingerprint">原文件名：{editing.original_filename || editing.file.split('/').pop()}<br />{editing.sha256 && <>SHA-256：<code title={editing.sha256}>{editing.sha256.slice(0, 16)}…</code></>}</p>{(['title', 'album', 'artist', 'version'] as const).map((key, index) => <label key={key}>{['曲名', '专辑', '歌手', '版本'][index]}<Input name={key} defaultValue={editing[key]} required={key !== 'artist'} /></label>)}<details><summary>音轨对应关系</summary><p>仅将分离的 vocal-only 轨道选为纯人声。Original Mix 是完整原曲。</p>{(['instrumental', 'vocals'] as const).map(role => <label key={role}>{role === 'instrumental' ? '伴奏' : '纯人声'}<select name={role} defaultValue={editing[role] ?? ''}><option value="">{role === 'instrumental' ? '请选择音轨' : '无纯人声'}</option>{editing.tracks.map(t => <option key={t.index} value={t.index}>轨道 {t.index} · {t.name}</option>)}</select></label>)}</details>
      <div className="source-actions"><label>新的 MP4 文件<Input name="replacement" type="file" accept=".mp4,video/mp4" disabled={replacing} /></label><p>新文件会复制进曲库；替换成功后只删除曲库里的旧文件，不会删除你电脑中选择的原件。</p><Button type="button" variant="outline" disabled={replacing} onClick={event => {
        const input = event.currentTarget.form?.elements.namedItem('replacement');
        if (!(input instanceof HTMLInputElement) || !input.files?.[0]) { c.libraryNotice('请先选择新的 MP4 文件'); return; }
        const data = new FormData(); data.set('file', input.files[0]); setReplacing(true);
        runLibrary(async () => { try { await c.api('/api/songs/' + editing.id + '/source', 'PUT', data); editDialog.current?.close(); await c.refresh(); c.libraryNotice('已替换源文件并删除曲库中的旧文件；请重新确认音轨'); } finally { setReplacing(false); } });
      }}>{replacing ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileVideo aria-hidden="true" />}{replacing ? '正在替换…' : '替换源文件'}</Button></div>
      <footer className="edit-footer"><Button type="button" className="danger-button" disabled={replacing} onClick={() => { setPendingDelete(editing); editDialog.current?.close(); }}><Trash2 aria-hidden="true" />删除歌曲</Button><span className="spacer" /><Button type="button" variant="outline" disabled={replacing} onClick={() => editDialog.current?.close()}><X aria-hidden="true" />取消</Button><Button className="primary" disabled={replacing}><Save aria-hidden="true" />保存</Button></footer></form>}</dialog>
    <dialog id="delete-dialog" ref={deleteDialog} onClose={() => setPendingDelete(null)}>{pendingDelete && <form onSubmit={event => {
      event.preventDefault(); const song = pendingDelete; setDeleting(true);
      runLibrary(async () => { try { await c.api('/api/songs/' + song.id, 'DELETE'); deleteDialog.current?.close(); await c.refresh(); c.libraryNotice(`已删除《${song.title}》及其曲库源文件`); } finally { setDeleting(false); } });
    }}><h2>确认删除歌曲？</h2><p>将从资料库删除《{pendingDelete.title}》，并删除软件曲库中的源文件。此操作无法撤销，但不会影响你电脑中曲库之外的原件。</p><footer><Button type="button" variant="outline" disabled={deleting} onClick={() => deleteDialog.current?.close()}><X aria-hidden="true" />取消</Button><Button className="danger-button" disabled={deleting}>{deleting ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}{deleting ? '正在删除…' : '确认删除'}</Button></footer></form>}</dialog>
  </>;
}
