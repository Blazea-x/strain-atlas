# 画像アップロード専用入口

ここは Cannabis Strains Wisdom の production 画像をアップロードする正式な入口です。必ず `master-migration` ブランチで使用してください。

画像ファイル名は `<strain-id>.jpg`、`<strain-id>.jpeg`、`<strain-id>.png`、`<strain-id>.webp` のいずれかにしてください。

例:

- `durban-poison.jpg`
- `kali-mist.jpg`
- `warlock.jpg`

複数画像をまとめてアップロードして構いません。IMAGE UPLOAD INBOX V1 がバッチ全体を検証し、正常な場合だけまとめて処理します。

正常処理後、アップロードした元画像は自動削除され、このフォルダには `README.md` と `.gitkeep` だけが残ります。

正式画像は `strains/<strain-id>/images/generated/primary.webp` に配置されます。

production 画像を `main/images/` や、その他の `images/` フォルダへ直接入れないでください。
