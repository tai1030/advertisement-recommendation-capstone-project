const DynamoDB = require("aws-sdk/clients/dynamodb");

// Load DynamoDB client
const dynamodb = new DynamoDB.DocumentClient({
    region: 'us-east-2'
});

exports.handler = async (event, context, callback) => {
    /*
        Example request query string format
        fid=F-1000001
        cid=C-1000001
    */
    const fid = event.queryStringParameters !== null && typeof event.queryStringParameters.fid !== 'undefined' ? event.queryStringParameters.fid : null;
    const cid = event.queryStringParameters !== null && typeof event.queryStringParameters.cid !== 'undefined' ? event.queryStringParameters.cid : null;

    const info = await getFile(fid);
    if (info !== null && typeof info.fid !== 'undefined') {
        // Tracking
        await trackDislike(cid, fid);
    }

    // API response
    return sendResponse({
        status: true
    });

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

async function getFile(fid) {
    const result = await dynamodb.query({
        TableName: 'file',
        KeyConditionExpression: '#fid = :fid',
        ExpressionAttributeNames: {
            '#fid': 'fid'
        },
        ExpressionAttributeValues: {
            ':fid': fid
        }
    }).promise();
    const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
    if (items.length > 0) {
        return items[0];
    } else {
        return null;
    }
}

async function trackDislike(cid, fid) {
    cid = (cid === null || cid === '') ? 'GUEST' : cid;
    const result = await dynamodb.query({
        TableName: 'tracking',
        KeyConditionExpression: '#fid = :fid AND #cid = :cid',
        ExpressionAttributeNames: {
            '#fid': 'fid',
            '#cid': 'cid'
        },
        ExpressionAttributeValues: {
            ':fid': fid,
            ':cid': cid
        }
    }).promise();
    const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
    var track = (items.length > 0) ? items[0] : {
        fid,
        cid,
        display: 0,
        click: 0,
        dislike: 0
    };

    track.dislike = (typeof track.dislike === 'undefined' ? 0 : track.dislike) + 1;

    return await dynamodb.update({
        TableName: 'tracking',
        Key: {
            'fid': fid,
            'cid': cid
        },
        UpdateExpression: 'set #dislike = :dislike',
        ExpressionAttributeNames: {
            '#dislike': 'dislike',
        },
        ExpressionAttributeValues: {
            ':dislike': track.dislike,
        },
        ReturnValues: "ALL_NEW"
    }).promise();
}