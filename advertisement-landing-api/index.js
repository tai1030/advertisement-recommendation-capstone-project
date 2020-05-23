const DynamoDB = require("aws-sdk/clients/dynamodb");

// Load DynamoDB client
const dynamodb = new DynamoDB.DocumentClient({
    region: 'us-east-2'
});

exports.handler = async (event, context, callback) => {
    /*
        Example request query string format
        aid=A-1000001
        fid=F-1000001
        cid=C-1000001
    */
    const aid = event.queryStringParameters !== null && typeof event.queryStringParameters.aid !== 'undefined' ? event.queryStringParameters.aid : null;
    const fid = event.queryStringParameters !== null && typeof event.queryStringParameters.fid !== 'undefined' ? event.queryStringParameters.fid : null;
    const cid = event.queryStringParameters !== null && typeof event.queryStringParameters.cid !== 'undefined' ? event.queryStringParameters.cid : null;

    const info = await getInfo(aid);
    if (info !== null && typeof info.aid !== 'undefined') {
        // Tracking
        await trackClick(cid, fid);
    }

    // Redirect to landing page
    if (typeof info.link === 'undefined') {
        return redirect('https://www.google.com');
    } else {
        return redirect(info.link);
    }

    function redirect(url) {
        callback(null, {
            isBase64Encoded: false,
            statusCode: 302,
            body: '',
            headers: {
                "Location": url
            }
        });
        return;
    }
};

async function getInfo(aid) {
    const result = await dynamodb.query({
        TableName: 'info',
        KeyConditionExpression: '#aid = :aid',
        ExpressionAttributeNames: {
            '#aid': 'aid'
        },
        ExpressionAttributeValues: {
            ':aid': aid
        }
    }).promise();
    const items = typeof result.Items !== 'undefined' && result.Items !== null ? result.Items : [];
    if (items.length > 0) {
        return items[0];
    } else {
        return null;
    }
}

async function trackClick(cid, fid) {
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

    track.click = (typeof track.click === 'undefined' ? 0 : track.click) + 1;

    return await dynamodb.update({
        TableName: 'tracking',
        Key: {
            'fid': fid,
            'cid': cid
        },
        UpdateExpression: 'set #click = :click',
        ExpressionAttributeNames: {
            '#click': 'click',
        },
        ExpressionAttributeValues: {
            ':click': track.click,
        },
        ReturnValues: "ALL_NEW"
    }).promise();
}