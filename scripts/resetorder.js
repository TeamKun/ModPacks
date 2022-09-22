const fs = require('fs')

const orderListJsonFilePath = './orderlist.json'
let orderListJson = JSON.parse(fs.readFileSync(orderListJsonFilePath, 'utf8'))
let orderList = orderListJson.orderList

fs.readdir('./servers', (err, files) => {
    // orderlist.jsonの初期化
    orderList.splice(0)
    files.forEach(file => {
        orderList.push(file)
    })
    fs.writeFileSync(orderListJsonFilePath, JSON.stringify(orderListJson, null, '\t'));

    // パック名の初期化
    files.forEach(file => {
        const metaJsonfilePath = `./servers/${file}/servermeta.json`
        let servermetaJson = JSON.parse(fs.readFileSync(metaJsonfilePath, 'utf8'))
        let serverName = servermetaJson.meta.name
        const orderReg = /^%*%/

        if (orderReg.test(serverName)) {
            isEdited = true
            serverName = serverName.split('%')[2]
        }

        servermetaJson.meta.name = serverName
        fs.writeFileSync(metaJsonfilePath, JSON.stringify(servermetaJson, null, '\t'));
    })
})