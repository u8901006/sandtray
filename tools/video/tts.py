# 教學影片旁白：narration.json → working/video/tts/<id>.mp3 與 durations.json（秒）。
# 參數 client：改用 client-narration.json → working/video-client/tts/（案主版，2026-10-10）。
# 用 edge-tts（只送出旁白腳本文字，無任何個案資料）；ffprobe 量實際長度供錄影腳本控制每段停留時間。
import asyncio, json, subprocess, sys
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parents[2]
GUIDE = sys.argv[1] if len(sys.argv) > 1 else 'therapist'
OUT = ROOT / 'working' / ('video' if GUIDE == 'therapist' else 'video-' + GUIDE) / 'tts'
SCRIPT = ROOT / 'tools' / 'video' / ('narration.json' if GUIDE == 'therapist' else GUIDE + '-narration.json')
VOICE = 'zh-TW-HsiaoChenNeural'


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    steps = json.loads(SCRIPT.read_text(encoding='utf-8'))
    durations = {}
    for step in steps:
        path = OUT / f"{step['id']}.mp3"
        await edge_tts.Communicate(step['say'], VOICE, rate='-5%').save(str(path))
        probe = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)],
                               capture_output=True, text=True, check=True)
        durations[step['id']] = round(float(probe.stdout.strip()), 2)
        print(step['id'], durations[step['id']])
    (OUT / 'durations.json').write_text(json.dumps(durations, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
