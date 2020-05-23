exports.handler = async (event, context, callback) => {
    /*
        Example request query string format
        cid=C-1000001
    */
    const cid = event.queryStringParameters !== null && typeof event.queryStringParameters.cid !== 'undefined' ? event.queryStringParameters.cid : null;

    var cidQueryString = '';
    if (cid !== null && cid !== '') {
        cidQueryString = 'cid=' + cid + '&';
    }

    const url = 'https://d3958c3lq9ou8y.cloudfront.net/?' + cidQueryString + 'platform=web&width=400&height=266&content={** [OPTIONAL] Put some content of your page here, can get related ads! **}';

    var response = [
        {
            'language': 'HTML',
            'code': '<iframe src="' + url + '" width="400" height="266"></iframe>',
        },
        {
            'language': 'React Native',
            'code': 'import React, { Component } from "react";\nimport { WebView } from "react-native-webview";\n\nclass MyWeb extends Component {\n  render() {\n    return (\n      <WebView\n        source={{ uri: "' + url + '" }}\n      />\n    );\n  }\n}',
        }
    ];

    
    // API response
    return sendResponse(response);

    function sendResponse(jsonObject) {
        callback(null, {
            isBase64Encoded: false,
            statusCode: 200,
            body: JSON.stringify(jsonObject),
            headers: {
                "Access-Control-Allow-Origin": "*"
            }
        });
        return;
    }
};