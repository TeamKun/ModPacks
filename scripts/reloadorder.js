const fs = require('fs')

const orderListJsonFilePath = './orderlist.json'
let orderListJson = JSON.parse(fs.readFileSync(orderListJsonFilePath, 'utf8'))
let orderList = orderListJson.orderList

fs.readdir('./servers', (err, files) => {

    // serversにないパックを削除
    let removeList = []
    orderList.forEach(server => {
        if (!files.includes(server)) {
            removeList.push(server)

        }
    })
    removeList.forEach(server => {
        let index = orderList.indexOf(server)
        orderList.splice(index, 1)
    })

    // listにないパックを追加
    files.forEach(file => {
        if (!orderList.includes(file)) {
            orderList.push(file)
        }
    })
    fs.writeFileSync(orderListJsonFilePath, JSON.stringify(orderListJson, null, '\t'));
})