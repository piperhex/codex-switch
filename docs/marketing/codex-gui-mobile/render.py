"""Render real device footage as a narrated 1080p promotional film."""

import argparse
import json
import math
import re
import shutil
import struct
import subprocess
import wave
from pathlib import Path

FPS = 30
WIDTH, HEIGHT = 1920, 1080
BG = "0x071e1b"
MINT = "0x84e9cc"
WHITE = "0xf4faf7"
MUTED = "0xa5bdb6"
COLOR = "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=limited"
STYLE_FORMAT = (
    "Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
    "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
    "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
)


def run(args):
    subprocess.run([str(arg) for arg in args], check=True)


def duration(path):
    data = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)
    ])
    return float(json.loads(data)["format"]["duration"])


def label(text, position, style, work):
    if "\n" in text:
        x, y = position
        return ",".join(label(line, (x, y + index * round(style[0] * 1.48)), style, work)
                        for index, line in enumerate(text.splitlines()))
    path = work / f"text-{len(list(work.glob('text-*.txt'))):03d}.txt"
    path.write_text(text, encoding="utf-8")
    x, y = position
    size, color = style
    return (
        f"drawtext=fontfile=font.ttc:textfile={path.name}:fontsize={size}:"
        f"fontcolor={color}:x={x}:y={y}:line_spacing=18"
    )


def caption_events(text, start, length):
    phrases = [part for part in re.split(r"[，。！？：]", text) if part]
    chunks = []
    for phrase in phrases:
        chunk, width = "", 0
        for token in re.findall(r"[A-Za-z]+|[^A-Za-z]", phrase):
            token_width = len(token) * (0.55 if token.isascii() else 1)
            if width + token_width > 28 and chunk:
                chunks.append(chunk.strip())
                chunk, width = "", 0
            chunk += token
            width += token_width
        if chunk.strip():
            chunks.append(chunk.strip())
    weights = [len(re.sub(r"[A-Za-z ]", "", part)) + len(re.findall(r"[A-Za-z]+", part)) * 2
               for part in chunks]
    total = sum(weights)
    cursor = start
    for part, weight in zip(chunks, weights):
        end = cursor + length * weight / total
        yield cursor, end, part
        cursor = end


def timestamp(seconds, ass=False):
    millis = round(seconds * 1000)
    hours, rest = divmod(millis, 3600000)
    minutes, rest = divmod(rest, 60000)
    secs, ms = divmod(rest, 1000)
    if ass:
        return f"{hours}:{minutes:02d}:{secs:02d}.{ms // 10:02d}"
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def subtitles(events, destination):
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: __STYLE_FORMAT__
Style: Default,Microsoft YaHei,40,&H00FFFFFF,&H000000FF,&H0010211D,&H8010211D,0,0,0,0,100,100,0,0,1,2.5,0,2,80,80,32,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    header = header.replace("__STYLE_FORMAT__", STYLE_FORMAT)
    ass, srt = [], []
    for index, (start, end, text) in enumerate(events, 1):
        ass.append(f"Dialogue: 0,{timestamp(start, True)},{timestamp(end, True)},Default,,0,0,0,,{text}")
        srt.append(f"{index}\n{timestamp(start)} --> {timestamp(end)}\n{text}\n")
    (destination / "subtitles.ass").write_text(header + "\n".join(ass), encoding="utf-8-sig")
    (destination / "subtitles.srt").write_text("\n".join(srt), encoding="utf-8-sig")


def bed(path, seconds):
    """Original quiet pad and repeating four-note motif; no sampled music."""
    rate = 24000
    frequencies = [130.8128, 164.8138, 195.9977, 246.9417]
    data = bytearray()
    for index in range(int(seconds * rate)):
        t = index / rate
        fade = min(t / 2, (seconds - t) / 3, 1)
        pad = sum(math.sin(2 * math.pi * freq * t) for freq in frequencies) / 4
        phase = t % 0.75
        note = frequencies[int(t / 0.75) % 4] * 4
        pulse = math.sin(2 * math.pi * note * t) * math.exp(-phase * 9)
        value = int(32767 * fade * (pad * 0.012 + pulse * 0.008))
        data.extend(struct.pack("<h", value))
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(data)


def base_filters(scene, work):
    filters = [
        "drawgrid=w=96:h=96:t=1:c=0x25473e@0.16",
        "drawbox=x=0:y=1000:w=1920:h=80:c=0x03130f@0.85:t=fill",
        "drawbox=x=80:y=128:w=54:h=4:c=0x84e9cc:t=fill",
        label("CODEX SWITCH  /  Codex GUI", (80, 52), (27, MINT), work),
        label(scene["chapter"], ("w-tw-80", 54), (25, MUTED), work),
    ]
    return filters


def add_footage(command, graph, shot, index):
    command.extend(["-ss", str(shot.get("start", 0)), "-i", str(shot["path"])])
    x, y, width, height = shot["box"]
    filters = [COLOR, "setpts=PTS-STARTPTS", "fps=30"]
    if "crop" in shot:
        crop_x, crop_y, crop_w, crop_h = shot["crop"]
        filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")
    filters.extend([f"scale={width}:{height}:flags=lanczos", "setsar=1", "tpad=stop_mode=clone:stop_duration=100"])
    graph.append(f"[{index}:v]" + ",".join(filters) + f"[shot{index}]")
    return x, y, width, height


def render_scene(scene, narration, paths):
    source, work = paths
    length = round((duration(source / f"voice-{narration['id']}.mp3") + 0.8) * FPS) / FPS
    command = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-filter_complex_threads", "2",
               "-f", "lavfi", "-i", f"color=c={BG}:s={WIDTH}x{HEIGHT}:r={FPS}:d={length}"]
    graph = ["[0:v]" + ",".join(base_filters(scene, work)) + "[base0]"]
    previous = "base0"
    for index, shot in enumerate(scene.get("shots", []), 1):
        shot = dict(shot, path=source / shot["file"])
        x, y, width, height = add_footage(command, graph, shot, index)
        graph.append(f"[{previous}]drawbox=x={x-4}:y={y-4}:w={width+8}:h={height+8}:"
                     f"color=0x507b6a:t=4[frame{index}]")
        graph.append(f"[frame{index}][shot{index}]overlay={x}:{y}:eof_action=repeat[base{index}]")
        previous = f"base{index}"
    overlays = []
    for item in scene.get("labels", []):
        overlays.append(label(item["text"], item["pos"], (item["size"], item.get("color", WHITE)), work))
    overlays += ["fade=t=in:d=0.22", f"fade=t=out:st={length-0.22}:d=0.22", "format=yuv420p"]
    graph.append(f"[{previous}]" + ",".join(overlays) + "[v]")
    audio_index = len(scene.get("shots", [])) + 1
    command.extend(["-i", str(source / f"voice-{narration['id']}.mp3")])
    graph.append(f"[{audio_index}:a]adelay=350|350,apad,atrim=duration={length},"
                 "aresample=48000,loudnorm=I=-16:TP=-2:LRA=7[a]")
    command.extend(["-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]", "-t", str(length),
                    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-threads", "4",
                    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart",
                    str(work / f"scene-{narration['id']}.mp4")])
    run(command)
    return length


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--scene", type=int)
    parser.add_argument("--assemble-only", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    source, output = args.source.resolve(), args.output.resolve()
    work = source / "render"
    work.mkdir(exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile("C:/Windows/Fonts/msyh.ttc", work / "font.ttc")
    import os
    os.chdir(work)
    narration = json.loads((root / "narration.json").read_text(encoding="utf-8"))
    scenes = json.loads((root / "scenes.json").read_text(encoding="utf-8"))
    lengths, events = [], []
    for index, (scene, voice) in enumerate(zip(scenes, narration), 1):
        if args.scene and args.scene != index:
            continue
        length = (duration(work / f"scene-{voice['id']}.mp4") if args.assemble_only
                  else render_scene(scene, voice, (source, work)))
        events.extend(caption_events(voice["text"], sum(lengths) + 0.35, length - 0.8))
        lengths.append(length)
        print(f"Rendered {index}: {length:.2f}s", flush=True)
    if args.scene:
        return
    subtitles(events, output)
    (work / "concat.txt").write_text("\n".join(f"file 'scene-{voice['id']}.mp4'" for voice in narration))
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
         "-i", work / "concat.txt", "-c", "copy", work / "joined.mp4"])
    bed(work / "original-bed.wav", sum(lengths))
    shutil.copyfile(output / "subtitles.ass", work / "subtitles.ass")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", work / "joined.mp4",
         "-i", work / "original-bed.wav", "-vf", "ass=subtitles.ass",
         "-filter_complex", "[0:a][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false[a]",
         "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-threads", "6", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
         "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
         output / "Codex-GUI-mobile-1080p.mp4"])
    (output / "timeline.json").write_text(json.dumps(lengths, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
