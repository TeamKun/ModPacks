// 手順を表示するためのスタイルをiframe内に追加する
frame = $("iframe[src=download_inframe]").contents();
if (frame.find(".manual-inframe-style").length == 0) {
    style = $("style:contains(.manual-info-button)");
    frame.find("head").append(style.clone().addClass("manual-inframe-style"));
}
// iframe内の要素を取得する
return frame.find("label[for=acd-check2]")