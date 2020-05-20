const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();
const DynamoDB = require("aws-sdk/clients/dynamodb");
const got = require('got');
const request = require('request-promise');
const fileType = require('file-type');

// Rekognition detect text min. confidence
var minConfidenceText = 40;

// Rekognition detect label min. confidence
var minConfidenceLabel = 40;

// S3 bucket name
var bucketName = "advertisement-files";

// Load DynamoDB client
const dynamodb = new DynamoDB.DocumentClient({
    region: 'us-east-2'
});

exports.handler = async (event, context) => {
    for (const record of event.Records) {
        if (record.eventName !== 'INSERT') {
            continue;
        }

        // Get DynamoDB inserted record object
        var data = AWS.DynamoDB.Converter.unmarshall(record.dynamodb.NewImage);
        console.log('DynamoDB trigger: Table "file" inserted record: ', JSON.stringify(data, null, 2));

        // Image URL(s) for single file
        var imageUrls = [];

        // For "html", scan HTML code to get all image URLs
        switch (data.type) {
            case 'image':
                imageUrls.push(data.url);
                break;
            case 'html':
                imageUrls = imageUrls.concat(getImageUrlsFromHtmlCode(data.content.replace(/\\/g, '')));
                break;
        }

        console.log('imageUrls: ', JSON.stringify(imageUrls, null, 2));

        // Download file from URL, and upload to S3 bucket
        var labels = {};
        for (var i in imageUrls) {
            const uploadResult = await uploadFileFromUrl(imageUrls[i], data.aid + '/' + data.fid);

            if (uploadResult === false) {
                console.error('Failed to download [' + imageUrls[i] + '], or not supported file format.');
                continue;
            }

            if (typeof uploadResult.key === 'undefined' || uploadResult.key === null || uploadResult.key === '') {
                console.error('Failed to upload [' + imageUrls[i] + '] to S3. (No key response) | Response: ' + JSON.stringify(uploadResult));
                continue;
            }

            // Detect labels and text on image by AWS Rekognition
            var imageLabels = await detectImage(uploadResult.key);
        }

        // Merge object across images
        for (var i in imageLabels) {
            if (i in labels) {
                labels[i] = Math.max(imageLabels[i], labels[i]);
            } else {
                labels[i] = imageLabels[i];
            }
        }

        console.log(labels);
        var relatedLabels = {};
        for (var i in labels) {
            var relatedWords = await getRelatedWords(i);
            for (var j in relatedWords) {
                relatedLabels[relatedWords[j]] = labels[i];
            }
        }

        // Merge object with related labels
        for (var i in relatedLabels) {
            if (i in labels) {
                labels[i] = Math.max(relatedLabels[i], labels[i]);
            } else {
                labels[i] = relatedLabels[i];
            }
        }

        // Create label records into DynamoDB
        var dynamoDbActions = [];
        for (var i in labels) {
            dynamoDbActions.push(addLabel(data.fid, i, labels[i]));
        }

        // (Await) Wait all DynamoDB actions finished
        await Promise.all(dynamoDbActions);
    }
};

async function uploadFileFromUrl(sourceUrl, targetPath) {
    // Download file from URL (and get file MIME)
    const [fileMime, response] = await Promise.all([
        fileType.fromStream(got.stream(sourceUrl)),
        request({
            uri: sourceUrl,
            encoding: null
        })
    ]);

    // Failed to download file, or file format not supported
    if (fileMime === null || response === null) {
        return false;
    }

    // Upload downloaded file to S3 bucket
    return await s3
        .upload({
            Bucket: bucketName,
            Key: targetPath + '.' + fileMime.ext,
            Body: response,
            ContentType: fileMime.mime,
            ACL: 'public-read'
        })
        .promise();
}

function getImageUrlsFromHtmlCode(html) {
    if (typeof html !== 'string') {
        return [];
    }

    var imageUrls = html.match(/(https?:\/\/[a-z\-_0-9\/\:\.]*\.(jpg|png))/ig);
    return Array.isArray(imageUrls) ? [...new Set(imageUrls)] : []; // Array unique
}

async function detectImage(s3ObjectKey) {
    // Async detect labels and text on image by AWS Rekognition
    const [texts, labels] = await Promise.all([
        rekognition.detectText({
            Image: {
                S3Object: {
                    Bucket: bucketName,
                    Name: s3ObjectKey
                }
            },
            Filters: {
                WordFilter: {
                    MinConfidence: minConfidenceText
                }
            }
        }).promise(),
        rekognition.detectLabels({
            Image: {
                S3Object: {
                    Bucket: bucketName,
                    Name: s3ObjectKey
                }
            },
            MinConfidence: minConfidenceLabel
        }).promise()
    ]);

    // Build result object (by text)
    var result = {};
    for (var i in texts['TextDetections']) {
        var text = texts['TextDetections'][i];
        if (text['Type'] !== 'WORD') {
            continue;
        }

        // To lower case
        text['DetectedText'] = text['DetectedText'].toLowerCase();

        if (text['DetectedText'] in result) {
            result[text['DetectedText']] = Math.max(text['Confidence'], result[text['DetectedText']]);
        } else {
            result[text['DetectedText']] = text['Confidence'];
        }
    }

    // Build result object (by labels)
    for (var i in labels['Labels']) {
        var label = labels['Labels'][i];

        // To lower case
        label['Name'] = label['Name'].toLowerCase();

        if (label['Name'] in result) {
            result[label['Name']] = Math.max(label['Confidence'], result[label['Name']]);
        } else {
            result[label['Name']] = label['Confidence'];
        }
    }

    return result;
}

// [TO-DO]
async function getRelatedWords(word) {
    /*
    const apiResponse = await request({
        method: 'POST',
        url: 'https://twinword-word-associations-v1.p.rapidapi.com/associations/',
        headers: {
            'x-rapidapi-host': 'twinword-word-associations-v1.p.rapidapi.com',
            'x-rapidapi-key': '73a5e4ece1mshb91defd88859d60p161349jsn646122d27639',
            'content-type': 'application/x-www-form-urlencoded',
            useQueryString: true
        },
        form: { entry: word }
    });
    console.log(apiResponse);
    */

    return [];
}

async function addLabel(fid, label, rate) {
    return await dynamodb.put({
        TableName: 'label',
        Item: {
            'fid': fid,
            'label': label,
            'rate': rate
        },
    }).promise();
}