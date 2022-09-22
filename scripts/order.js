const fs = require('fs')

const orderListJsonFilePath = './orderlist.json'
let orderListJson = JSON.parse(fs.readFileSync(orderListJsonFilePath, 'utf8'))
let orderList = orderListJson.orderList

fs.readdir('./servers', (err, files) => {
    files.forEach(file => {
        let isEdited = false
        const metaJsonfilePath = `./servers/${file}/servermeta.json`
        let servermetaJson = JSON.parse(fs.readFileSync(metaJsonfilePath, 'utf8'))
        let serverName = servermetaJson.meta.name
        const orderReg = /^%*%/

        // オーダーの初期化
        if (orderReg.test(serverName)) {
            isEdited = true
            serverName = serverName.split('%')[2]
        }

        // オーダー変更
        for (let i = 0; i < orderList.length; i++) {
            if (orderList[i] == file) {
                isEdited = true
                serverName = `%${i}%${serverName}`
            }
        }

        // 書き込み
        if (isEdited) {
            servermetaJson.meta.name = serverName
            fs.writeFileSync(metaJsonfilePath, JSON.stringify(servermetaJson, null, '\t'));
        }
    })
})