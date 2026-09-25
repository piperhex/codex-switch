import asyncio
import argparse
import json
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent
VOICE = "zh-CN-XiaoxiaoNeural"

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT)
    parser.add_argument("--only")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    segments = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))
    for segment in segments:
        if args.only and args.only != segment["id"]:
            continue
        destination = args.output / f"voice-{segment['id']}.mp3"
        if not args.only and destination.exists() and destination.stat().st_size > 1000:
            continue
        voice = edge_tts.Communicate(segment["text"], VOICE, rate="+0%", pitch="+0Hz")
        await voice.save(str(destination))
        print(segment["id"], destination.stat().st_size, flush=True)

asyncio.run(main())
