import { computed, reactive, ref, watch } from 'vue'

function request({
    url,
    method = "post",
    data,
    headers = {},
    onprogress = e => e,
    requestList = []
}) {
    return new Promise(resolve => {
        const xhr = new XMLHttpRequest()
        xhr.upload.onprogress = onprogress
        xhr.open(method, url)
        Object.keys(headers).forEach((key) => {
            xhr.setRequestHeader(key, headers[key])
        })
        xhr.send(data)
        xhr.onload = e => {
            if (requestList) {
                const index = requestList.findIndex(item => item === xhr)
                requestList.splice(index, 1)
            }
            resolve({
                data: e.target.response
            })
        }
        requestList.push(xhr)
    })
}

export default {
    setup() {
        const BlobSize = 10 * 1024 * 1024 // 单个分片大小 单位是bit
        let uploadfile = null // 要上传的文件
        let requestList = [] // 记录每一个分片发出的请求
        let fileChunkList = ref([]) // 记录每一个分片的信息
        let hashCalcPercentage = ref(0) // 计算hash的百分比
        const fakePercentage = reactive({
            upload: 0
        })
        // 总的进度的百分比
        const uploadPercentage = computed(() => {
            if (!fileChunkList.value.length) return 0
            const loaded = fileChunkList.value
                .map(item => item.chunk.size * item.percentage)
                .reduce((acc, cur) => acc + cur)
            return (loaded / uploadfile.size).toFixed(2)
        })

        watch(uploadPercentage, (newVal) => {
            console.log(fakePercentage.upload)
            if (parseInt(newVal) > parseInt(fakePercentage.upload)) {
                // console.log(newVal, fakePercentage.upload)
                fakePercentage.upload = newVal
            }
        })

        // 创建分片
        function createFileChunk(file, size = BlobSize) {
            const fileChunkList = []
            let cur = 0
            while (cur < file.size) {
                fileChunkList.push({ file: file.slice(cur, cur + size) })
                cur += size
            }
            return fileChunkList
        }
        // 上传分片
        async function uploadChunks(filename, fileChunkList, uploadedList) {
            function createProgressHandler(item) {
                return e => {
                    item.percentage = parseInt(e.loaded / e.total * 100)
                }
            }
            fileChunkList = fileChunkList
                .filter(({ hash }) => !uploadedList.includes(hash))
                .map(({ chunk, hash, index, fileHash }) => {
                    const formData = new FormData()
                    formData.append('chunk', chunk)
                    formData.append('hash', hash)
                    formData.append('filehash', fileHash)
                    formData.append('filename', filename)
                    return { formData, index }
                })
                .map(({ formData, index }) => request({
                    url: 'http://localhost:3000',
                    data: formData,
                    onprogress: createProgressHandler(fileChunkList[index]),
                    requestList
                }))
            return await Promise.all(fileChunkList)
        }
        // 合并分片
        async function mergeRequest(filename, fileHash) {
            return await request({
                url: "http://localhost:3000/merge",
                headers: {
                    "content-type": "application/json"
                },
                data: JSON.stringify({
                    filename,
                    fileHash,
                    size: BlobSize
                })
            })
        }
        // 选择文件后保存
        function handleChange(event) {
            const [file] = event.target.files
            uploadfile = file
        }
        // 交给webworker计算hash
        function calculateHash(fileChunkList) {
            return new Promise(resolve => {
                let worker = new Worker('/hash.js')
                worker.postMessage({ fileChunkList })
                worker.onmessage = e => {
                    const { percentage, hash } = e.data
                    if (hash) {
                        console.log(hash)
                        resolve(hash)
                    }
                    hashCalcPercentage.value = percentage.toFixed(2)
                }
            })
        }
        // 验一下剩多少没传完
        async function verifyUpload(filename, fileHash) {
            const { data } = await request({
                url: 'http://localhost:3000/verify',
                headers: {
                    'content-type': 'application/json'
                },
                data: JSON.stringify({
                    filename,
                    fileHash
                })
            })
            return JSON.parse(data)
        }
        // 上传按钮触发
        async function handleUpload() {
            const filechunklist = createFileChunk(uploadfile);
            // [filechunklist[0], filechunklist[1]] = [filechunklist[1], filechunklist[0]] // 切片顺序换了hash值也不一样
            const fileHash = await calculateHash(filechunklist)

            // 检验下是不是已经有了
            const { shouldUpload, uploadedList } = await verifyUpload(uploadfile.name, fileHash)
            if (!shouldUpload) return alert('有了')

            fileChunkList.value = filechunklist.map(({ file }, index) => ({
                chunk: file,
                index,
                hash: fileHash + '-' + index,
                fileHash,
                percentage: uploadedList.includes(fileHash + '-' + index) ? 100 : 0
            }))

            console.log('要上传文件：', uploadfile)

            await uploadChunks(uploadfile.name, fileChunkList.value, uploadedList)
            await mergeRequest(uploadfile.name, fileHash)
            alert('上传成功')
            // 报错没有捕获所以不会往下执行
            // uploadfile = null
        }
        // 暂停
        async function handleStop() {
            console.log('暂停')
            requestList.forEach(xhr => xhr.abort())
            requestList = []
        }

        return () => {
            const flexStyle = { 'display': 'flex', 'justify-content': 'center' }
            const bar = (val) => {
                const barStyle = {
                    height: '20px',
                    width: '200px'
                }
                const innerBarStyle = {
                    width: (val * barStyle.width.replace('px', '') / 100).toFixed(2) + 'px',
                    height: '100%',
                    'background-color': 'black'
                }
                return <div style={barStyle}>
                    <div style={innerBarStyle}></div>
                </div>
            }

            return (
                <div>
                    <input type="file" onChange={handleChange} />
                    <button onclick={handleUpload}>上传</button>
                    <button onclick={handleStop}>暂停</button>
                    <div style={flexStyle}>
                        hash进度
                        {bar(hashCalcPercentage.value)}
                        {hashCalcPercentage.value}%
                    </div>
                    <div style={flexStyle}>
                        总进度
                        {bar(fakePercentage.upload)}
                        {uploadPercentage.value}%
                    </div>
                    {
                        fileChunkList.value.map(item => {
                            return <div style={flexStyle}>
                                {item.hash}
                                {bar(item.percentage)}
                                {item.percentage}%
                            </div>
                        })
                    }
                </div>
            )
        }
    }
}