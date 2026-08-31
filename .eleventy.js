module.exports = function(eleventyConfig) {
    // Copy static assets to output
    eleventyConfig.addPassthroughCopy("src/css");
    eleventyConfig.addPassthroughCopy("src/audio"); 
    eleventyConfig.addPassthroughCopy("src/music");
    eleventyConfig.addPassthroughCopy("src/images");
    eleventyConfig.addPassthroughCopy("src/downloads"); 
    
    // Collection for blog posts
    eleventyConfig.addCollection("blog", function(collection) {
        return collection.getFilteredByTag("blog").reverse();
    });
    
    // Custom filters
    eleventyConfig.addFilter("readableDate", function(date) {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    });
    
    eleventyConfig.addFilter("isoDate", function(date) {
        return new Date(date).toISOString().split('T')[0];
    });
    
    eleventyConfig.addFilter("limit", function(array, limit) {
        return array.slice(0, limit);
    });
    
    return {
        dir: {
            input: "src",
            output: "public"
        }
    };
};