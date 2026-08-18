# IMAGE UPLOAD INBOX V1

人間が画像を投入する正式入口は、リポジトリ直下の `UPLOAD_IMAGES_HERE/` です。

画像のアップロード方法とファイル名ルールは `UPLOAD_IMAGES_HERE/README.md` を確認してください。

IMAGE UPLOAD INBOX V1 は `master-migration` 上で、既存strain確認、バッチ全体のatomic検証、WebP変換、RIFF/WEBP検証、画像decode検証、production manifest / approval guard、既存published primary保護、正式primary配置、正常処理後の元画像削除を行います。
