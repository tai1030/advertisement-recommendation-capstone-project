const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const DynamoDB = require("aws-sdk/clients/dynamodb");
const got = require('got');
const request = require('request-promise');
const fileType = require('file-type');
const { v4: uuid } = require('uuid');

// S3 bucket name
var bucketName = "advertisement-files";

// Load DynamoDB client
const dynamodb = new DynamoDB.DocumentClient({
    region: 'us-east-2'
});

exports.handler = async (event, context, callback) => {
    /*
        Example request JSON format
          - "title" and "link" accept empty string or null, all other attriables are required.
        {
            "id": "AD-1000001",
            "title": "CCBBstore Mega sales! Up to 88% off!",
            "link": "https://www.ccbbstore.com",
            "files": [
                {
                    "type": "image",
                    "url": "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png",
                    "width": 272,
                    "height": 92
                },
                {
                    "type": "html",
                    "content": "<img src=\"https://www.tutorialrepublic.com/examples/images/objects.png\" usemap=\"#objects\" alt=\"Objects\"><map name=\"objects\"><area shape=\"circle\" coords=\"137,231,71\" href=\"https://google.com\" alt=\"Clock\"><area shape=\"poly\" coords=\"363,146,273,302,452,300\" href=\"https://yahoo.com\" alt=\"Sign\"><area shape=\"rect\" coords=\"520,160,641,302\" href=\"https://ztore.com\" alt=\"Book\"></map>",
                    "width": 700,
                    "height": 400
                }
            ]
        }
    */
    const requestBody = JSON.parse(event.body);
    console.log(requestBody);

    // Check request body format
    if (!validateRequestBody(requestBody)) {
        return sendResponse({
            "status": false,
            "message": "Invalid request"
        });
    }

    // Batch DynamoDB write actions (promise)
    var dynamoDbActions = [];

    // Detect create or update
    var isUpdate = false;
    var aid;
    if (await isInfoExists(requestBody.id)) {
        isUpdate = true;
        aid = requestBody.id;
    } else {
        isUpdate = false;

        // Generate new "aid"
        aid = uuid();
    }

    // (Async) Add "info" to DynamoDB
    if (isUpdate) {
        await removeAllFilesByAid(aid);
        dynamoDbActions.push(updateInfo(aid, requestBody.title, requestBody.link));
    } else {
        dynamoDbActions.push(addInfo(aid, requestBody.title, requestBody.link));
    }

    // Download file(s) from URL and upload to S3 bucket
    for (var i in requestBody.files) {
        // Generate new "fid"
        var fid = uuid();

        // (Async) Add "file" to DynamoDB
        switch (requestBody.files[i].type) {
            case 'image':
                dynamoDbActions.push(addFileImage(fid, aid, requestBody.files[i].url, requestBody.files[i].width, requestBody.files[i].height));
                break;
            case 'html':
                dynamoDbActions.push(addFileHtml(fid, aid, requestBody.files[i].content, requestBody.files[i].width, requestBody.files[i].height));
                break;
        }
    }

    // (Await) Wait all DynamoDB actions finished
    await Promise.all(dynamoDbActions);

    // API response
    return sendResponse({
        "status": true,
        "message": isUpdate ? "Updated 1 advertisement successfully" : "Added 1 advertisement successfully"
    });

    function sendResponse(jsonObject) {
        callback(null, {
            isBase64Encoded: false,
            statusCode: 200,
            body: JSON.stringify(jsonObject),
            headers: {
                "Access-Control-Allow-Origin": trustedCorsReferrer(event.headers['Referer'] !== undefined ? event.headers['Referer'] : '')
            }
        });
        return;
    }
};

function validateRequestBody(requestBody) {
    if (typeof requestBody === 'undefined') {
        console.warn('API request validatation failed | Check: requestBody=undefined');
        return false;
    }

    // Check rules for base object
    const rules = [
        typeof requestBody.id === 'string' && requestBody.id !== '',
        (typeof requestBody.title === 'string' || (typeof requestBody.title !== 'undefined' && requestBody.title === null)),
        (typeof requestBody.link === 'string' || (typeof requestBody.link !== 'undefined' && requestBody.link === null)),
        typeof requestBody.files === 'object' && Array.isArray(requestBody.files) && requestBody.files.length >= 1,
    ];
    if (!rules.every(Boolean)) {
        console.warn('API request validatation failed (base object) | Check: ' + JSON.stringify(rules));
        return false;
    }

    // Check rules for each object in "files" array
    for (var i in requestBody.files) {
        // Check rules for "type"
        var fileRules = [
            typeof requestBody.files[i].type === 'string',
            ['image', 'html'].includes(requestBody.files[i].type)
        ];
        if (!fileRules.every(Boolean)) {
            console.warn('API request validatation failed (file object) | Check: ' + JSON.stringify(fileRules));
            return false;
        }

        // Check rules for other fields
        fileRules = [
            typeof requestBody.files[i].width === 'number' && requestBody.files[i].width > 0,
            typeof requestBody.files[i].height === 'number' && requestBody.files[i].height > 0,
        ];
        switch (requestBody.files[i].type) {
            case 'image':
                fileRules.push(typeof requestBody.files[i].url === 'string' && requestBody.files[i].url !== '');
                break;
            case 'html':
                fileRules.push(typeof requestBody.files[i].content === 'string' && requestBody.files[i].content !== '');
                break;
        }
        if (!fileRules.every(Boolean)) {
            console.warn('API request validatation failed (other fields) | Check: ' + JSON.stringify(fileRules));
            return false;
        }
    }

    return true;
}

async function isInfoExists(aid) {
    var result = await dynamodb.query({
        TableName: 'info',
        KeyConditionExpression: '#aid = :aid',
        ExpressionAttributeNames: {
            '#aid': 'aid'
        },
        ExpressionAttributeValues: {
            ':aid': aid
        }
    }).promise();

    return result.Items.length > 0;
}

async function addInfo(aid, title, link) {
    return await dynamodb.put({
        TableName: 'info',
        Item: {
            'aid': aid,
            'title': title,
            'link': link
        },
    }).promise();
}

async function updateInfo(aid, title, link) {
    return await dynamodb.update({
        TableName: 'info',
        Key: {
            'aid': aid
        },
        ConditionExpression: '#aid = :aid',
        UpdateExpression: 'set #title = :title, #link = :link',
        ExpressionAttributeNames: {
            '#aid': 'aid',
            '#title': 'title',
            '#link': 'link',
        },
        ExpressionAttributeValues: {
            ':aid': aid,
            ':title': title,
            ':link': link,
        },
        ReturnValues: "ALL_NEW"
    }).promise();
}

async function addFileImage(fid, aid, url, width, height) {
    return await dynamodb.put({
        TableName: 'file',
        Item: {
            'fid': fid,
            'aid': aid,
            'type': 'image',
            'url': url,
            'width': width,
            'height': height
        },
    }).promise();
}

async function addFileHtml(fid, aid, content, width, height) {
    return await dynamodb.put({
        TableName: 'file',
        Item: {
            'fid': fid,
            'aid': aid,
            'type': 'html',
            'content': content,
            'width': width,
            'height': height
        },
    }).promise();
}

async function removeAllFilesByAid(aid) {
    // Select what records will be remove...
    var deleteFids = [];
    const result = await dynamodb.query({
        TableName: 'file',
        IndexName: 'aid-index',
        KeyConditionExpression: '#aid = :aid',
        ExpressionAttributeNames: {
            '#aid': 'aid',
        },
        ExpressionAttributeValues: {
            ':aid': aid,
        }
    }).promise();

    // Batch delete records...
    var batchData = [];
    for (var i in result.Items) {
        if (typeof result.Items[i].fid === 'undefined' || result.Items[i].fid === null) {
            continue;
        }
        batchData.push({
            DeleteRequest: {
                Key: {
                    key: result.Items[i].fid
                }
            }
        });
    }
    
    return await dynamodb.batchWrite({
        RequestItems: {
            ['file']: batchData
        }
    }).promise();
}

function trustedCorsReferrer(referrer) {
    if (referrer.startsWith('http://localhost/')) {
        return 'http://localhost';
    }
}