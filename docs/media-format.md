# Karaoke MP4 interface v1

The player consumes finished videos; it does not require a particular production application or lyric schema. Subtitles and title cards are already rendered into the video.

## Recommended media

- MP4 container, one H.264 video stream, and two AAC audio streams.
- First audio track: instrumental, with `handler_name=Instrumental`; default disposition enabled.
- Second audio track: isolated vocals only, with `handler_name=Vocals`; default disposition disabled.
- Both audio tracks refer to the same performance and time zero. Preserve any intentional leading silence. Recommended sample rate is 44.1 kHz stereo; decoding normalizes both streams to 44.1 kHz stereo PCM.
- Track lengths should cover the same video timeline. Encoding delay, cropping and title-card offsets must be handled by the producer.

The current importer prefers track `title` when present, then `handler_name`; use matching values when providing both tags. It recognizes instrumental/vocal labels, not the codec stream index alone. An `Original Mix` track contains instruments plus vocals and is never automatically treated as isolated vocals. Users can explicitly map unlabelled tracks in the editor. A single audio track can play without independent guide vocals.

Audio output is accompaniment gain × instrumental + guide gain × isolated vocals, followed by master level and limiting. Increasing guide vocals does not attenuate the accompaniment. The embedded video's own audio is always muted. The audience window is also muted; one controller owns the audio clock.

## Portable library

`library.json` stores schema version 1, a library ID and version entries with stable IDs, song title, artist, album, version and media paths relative to the library root. Multiple versions are grouped by album + title + artist. Copy the entire library directory to relocate it; do not rewrite individual relative media paths.

The `.karaoke-cache/` directory is disposable, and browser queues/history/settings are not part of the library. Imported MP4 bytes are preserved; preparation creates PCM cache files instead of modifying the source MP4.
