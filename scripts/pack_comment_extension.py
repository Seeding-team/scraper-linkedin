import os
import zipfile

def pack_extension():
    source_dir = os.path.abspath('extensions/comment-extension')
    targets = [
        os.path.abspath('linkedin-crawler-ui/public/comment-extension.zip'),
        os.path.abspath('extensions/comment-extension.zip')
    ]

    for target_zip in targets:
        os.makedirs(os.path.dirname(target_zip), exist_ok=True)
        with zipfile.ZipFile(target_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(source_dir):
                for file in files:
                    if file.endswith('.zip') or file.startswith('.'):
                        continue
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, source_dir)
                    zipf.write(full_path, rel_path)
        print(f"Packed {target_zip} ({os.path.getsize(target_zip):,} bytes)")

if __name__ == '__main__':
    pack_extension()
