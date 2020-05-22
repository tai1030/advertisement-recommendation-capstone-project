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

    var response = [
        {
            'language': 'HTML',
            'code': '<iframe src="http://127.0.0.1/?' + cidQueryString + 'platform=web&width=400&height=266&content=Cars%20have%20controls%20for%20driving,%20parking,%20passenger%20comfort,%20and%20a%20variety%20of%20lights.%20Over%20the%20decades,%20additional%20features%20and%20controls%20have%20been%20added%20to%20vehicles,%20making%20them%20progressively%20more%20complex,%20but%20also%20more%20reliable%20and%20easier%20to%20operate.%20These%20include%20rear%20reversing%20cameras,%20air%20conditioning,%20navigation%20systems,%20and%20in-car%20entertainment.%20Most%20cars%20in%20use%20in%20the%202010s%20are%20propelled%20by%20an%20internal%20combustion%20engine,%20fueled%20by%20the%20combustion%20of%20fossil%20fuels.%20Electric%20cars,%20which%20were%20invented%20early%20in%20the%20history%20of%20the%20car,%20became%20commercially%20available%20in%20the%202000s%20and%20are%20predicted%20to%20cost%20less%20to%20buy%20than%20gasoline%20cars%20before%202025."></iframe>',
        },
        {
            'language': 'React Native',
            'code': '<WebView [TO-DO] ................. />',
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