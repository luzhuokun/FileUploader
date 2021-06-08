const http = require('http')
const server = http.createServer()
const path = require('path')
const fse = require('fs-extra')
const multiparty = require("multiparty")

const extractExt = filename => filename.slice(filename.lastIndexOf("."), filename.length); // 提取后缀名

const UPLOAD_DIR = path.resolve(__dirname, "target")

const resolvePost = req => new Promise(resolve => {
    let chunk = ""
    req.on('data', data => {
        chunk += data
    })
    req.on('end', () => {
        resolve(JSON.parse(chunk))
    })
})
const pipeStream = (path, writeStream) => new Promise(resolve => {
    const readStream = fse.createReadStream(path);
    readStream.on("end", () => {
        fse.unlinkSync(path); // 删除
        resolve();
    });
    readStream.pipe(writeStream, { end: false });
})

const mergeFileChunk = async (filePath, fileHash, size) => {
    const chunkDir = path.resolve(UPLOAD_DIR, fileHash)
    const chunkPaths = await fse.readdir(chunkDir)
    // 排序
    chunkPaths.sort((a, b) => a.split("-")[1] - b.split("-")[1]);

    let targetStream = fse.createWriteStream(filePath)

    for (let chunkPath of chunkPaths) {
        await pipeStream(path.resolve(chunkDir, chunkPath), targetStream)
    }

    // todo 合并后有bug
    // await Promise.all(
    //     chunkPaths.map((chunkPath, index) =>
    //         pipeStream(
    //             path.resolve(chunkDir, chunkPath),
    //             // 指定位置创建可写流
    //             fse.createWriteStream(filePath, {
    //                 start: index * size,
    //                 // end: (index + 1) * size
    //             })
    //         )
    //     )
    // )

    // 删掉整个文件夹
    fse.rmdirSync(chunkDir)
}

server.on("request", async (req, res) => {
    // 跨域
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader("Access-Control-Allow-Headers", "*")
    if (req.method === 'OPTIONS') {
        req.status = 200
        res.end()
        return;
    }

    // 合并
    if (req.url === '/merge') {
        const data = await resolvePost(req)
        const { fileHash, filename, size } = data
        const ext = extractExt(filename)
        const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`)

        await mergeFileChunk(filePath, fileHash, size)
        res.end(
            JSON.stringify({
                code: 0,
                message: 'file merged success'
            })
        )
        return;
    }

    // 验证
    if (req.url === '/verify') {
        const { filename, fileHash } = await resolvePost(req)
        const ext = extractExt(filename)
        const filePath = path.resolve(UPLOAD_DIR, `${fileHash}${ext}`)
        if (fse.existsSync(filePath)) {
            res.end(JSON.stringify({
                shouldUpload: false
            }))
        } else {
            const uploadedList = []
            // 先找文件夹
            if (fse.existsSync(path.resolve(UPLOAD_DIR, fileHash))) {
                // 再找文件
                uploadedList.push(...fse.readdirSync(path.resolve(UPLOAD_DIR, fileHash)))
            }
            res.end(JSON.stringify({
                shouldUpload: true,
                uploadedList
            }))
        }
        return;
    }

    // 分片
    const multipart = new multiparty.Form()
    multipart.parse(req, async (err, fields, files) => {
        if (err) {
            console.error(err)
            return
        }
        const [chunk] = files.chunk
        const [hash] = fields.hash
        // const [filename] = fields.filename
        const [filehash] = fields.filehash
        const chunkDir = path.resolve(UPLOAD_DIR, filehash)
        if (!fse.existsSync(chunkDir)) await fse.mkdirs(chunkDir)
        await fse.move(chunk.path, `${chunkDir}/${hash}`, { overwrite: true })
        res.end('received file chunk')
    })
})

server.listen(3000, () => console.log("正在监听 3000 端口"))
