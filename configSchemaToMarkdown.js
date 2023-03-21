
const fs = require('fs');
const schema = require('./config-schema.json');
const md = [
    `# ${schema.title}`,
    `Generated automatically from [config-schema.json](./config-schema.json).\n`
];

const addEntries = (properties, propNameParent) => {
    for (const propName in properties) {
        const data = properties[propName];
        addEntry(propNameParent ? `${propNameParent}.${propName}` : propName, data);
    }
};
const addEntry = (propName, data) => {
    const type = (data.type == 'array') ? `${data.items.type}[]` : data.type;
    md.push(`### ${type} \`${propName}\``);
    md.push(data.markdownDescription || (data.description || '').replace(/\n/g, '\n\n'));
    if (data.enum) {
        md.push(`\nAcceptable values: ${data.enum.map(value => `\`${value}\``).join(', ')}`);
    }
    md.push(`\n`);
    if (data.type == 'object') {
        addEntries(data.properties, propName);
    }
    if (data.type == 'array') {
        if (data.items.type == 'object') {
            addEntries(data.items.properties, `${propName}[]`);
        }
    }
};
addEntries(schema.properties);

fs.writeFileSync('./config-schema.md', md.join('\n').replace(/\n\n\n/g, '\n\n'));