$(function() {
  var converter = new Showdown.converter();

  Handlebars.registerHelper('markdown', function(text) {
    if (text) {
      text = text.replace(/\@(\w*)/g, function(match, code) {
        return '<a href="https://github.com/' + code + '" target="_blank">@' + code + '</a>';
      });
      return converter.makeHtml(text);
    }
    return '';
  });

  Handlebars.registerHelper('preview', function(text) {
    return $.trim(text).substring(0, 140).split(' ').slice(0, -1).join(' ') + '...';
  });

  var App = {};

  /**
   * Base class used by models so that you don't have to use full URLs but attempt to
   * make the URL construction dynamic, thereby making it easier to change base URL,
   * enable JSONP support, etc.
   */
  var ServiceModel = {
    service: '',
    url: function() {
      var self = this;
      var url = App.server + this.service.replace(/\{\{(\w*)\}\}/g, function(match, code) {
        return self[code];
      });
      var args = [];
      if (App.jsonp) {
        args.push('callback=?');
      }
      _.each(this.queryParams, function(param) {
        args.push(param + '=' + self[param]);
      });
      if (args.length > 0) {
        url += '?' + args.join('&');
      }
      return url;
    },
    parse: function(response, xhr) {
      return response.data;
    }
  };

  App.Model = Backbone.Model.extend({});
  App.Collection = Backbone.Collection.extend({});

  _.extend(App.Model.prototype, ServiceModel);
  _.extend(App.Collection.prototype, ServiceModel);

  /**
   * Base view class which includes some concepts I've used on various projects.
   */
  App.View = Backbone.View.extend({
    initialize: function(options) {
      this.bindings = [];
      this.views = {};
      return this;
    },
    render: function() {
      // normally I'd precompile templates or at least cache this
      this.template = Handlebars.compile($('#' + this.templateName).html());
      var json = this.model ? this.model.toJSON() : {};
      this.$el.html(this.template(json));
      return this;
    },
    // bindTo, unbindFromAll, and dispose methods based on a pattern described here:
    // http://stackoverflow.com/questions/7567404/backbone-js-repopulate-or-recreate-the-view/7607853#7607853
    bindTo: function(dataObject, evnt, callback, context) {
      dataObject.on(evnt, callback, context);
      this.bindings.push({
        dataObject: dataObject,
        evnt: evnt,
        callback: callback
      });
      return this;
    },
    unbindFromAll: function() {
      _.each(this.bindings, function(binding) {
        binding.dataObject.off(binding.evnt, binding.callback);
      });
      this.bindings = [];
      return this;
    },
    dispose: function() {
      this.disposeViews();
      this.unbindFromAll(); // this will unbind all events that this view has bound to
      this.off(); // this will unbind all listeners to events from this view. This is probably not necessary because this view will be garbage collected.
      this.remove(); // uses the default Backbone.View.remove() method which removes this.el from the DOM and removes DOM events.
      this.undelegateEvents(); // removes $el bindings established through 'events' attr
      this.unrender();
      return this;
    },
    disposeViews: function() {
      _.each(this.views, function(view) {
        view.dispose();
      });
      this.views = {};
      return this;
    },
    unrender: function() {
      this.$el.empty();
      return this;
    }
  });

  /**
   * View for collections which knows how to take a collection and an item renderer
   * and then create children. Similar to concepts I've used in the Flex framework.
   */
  App.CollectionView = App.View.extend({
    initialize: function(options) {
      App.View.prototype.initialize.call(this, options);
      this.bindTo(this.collection, 'reset', this.render, this);
      this.bindTo(this.collection, 'add', this.add, this);
      return this;
    },
    createItemRenderer: function(model) {
      return new this.itemRenderer({
        model: model
      });
    },
    add: function(model) {
      var item = this.createItemRenderer(model);
      this.views[model.cid] = item;
      this.$el.prepend(item.render().el);
      return this;
    },
    render: function() {
      this.disposeViews();
      var fragment = document.createDocumentFragment();
      this.collection.each(function(model) {
        var item = this.createItemRenderer(model);
        this.views[model.cid] = item;
        fragment.appendChild(item.render().el);
      }, this);
      this.$el.html(fragment);
      return this;
    }
  });

  /**
   * Over time I've been moving to have a single App view, sometimes called a Stage
   * and an app model which I consider the state. I didn't do that here but when I have
   * I then pass the state object to the router so that it could change views by simply
   * changing the state. Here I just used to hang the issues collection off of.
   */
  App.State = App.Model.extend({
    defaults: function() {
      return {
        page: '1'
      };
    },
    initialize: function(options) {
      App.Model.prototype.initialize.call(this, options);
      this.issues = new App.Issues({
        page: this.get('page')
      });
      this.issues.fetch();
      return this;
    }
  });

  /**
   * Issue model which also creates a sub model for comments.
   */
  App.Issue = App.Model.extend({
    service: '/issues/{{id}}',
    initialize: function(options) {
      App.Model.prototype.initialize.call(this, options);
      this.comments = new App.Comments({
        id: this.get('id')
      });
      this.comments.fetch();
      return this;
    }
  });

  /**
   * Issues collection which also extracts the pagination information out of the
   * response from Github.
   */
  App.Issues = App.Collection.extend({
    model: Backbone.Model,
    service: '/issues',
    queryParams: ['page'],
    initialize: function(options) {
      App.Collection.prototype.initialize.call(this, options);
      this.page = options.page;
    },
    extractPageInfo: function(response) {
      // I think it sucks the way Github declares this Link info
      var getUrlParam = function(url, name) {
        var results = new RegExp('[?&]' + name + '=([^&#]*)').exec(url);
        if (!results) {
          return 0;
        }
        return results[1];
      };
      var links = {};
      _.each(response.meta.Link, function(link) {
        // I'm totally relying on the order of the array here
        links[link[1].rel] = getUrlParam(link[0], 'page');
      });
      this.links = links;
    },
    parse: function(response, xhr) {
      this.extractPageInfo(response);
      return App.Collection.prototype.parse.call(this, response, xhr);
    }
  });

  /**
   * Comments collection which grabs the issue ID as it's passed in.
   */
  App.Comments = App.Collection.extend({
    model: Backbone.Model,
    service: '/issues/{{id}}/comments',
    initialize: function(options) {
      App.Collection.prototype.initialize.call(this, options);
      this.id = options.id;
    }
  });

  /**
   * Issue item renderer which issues a navigation event when clicked on.
   */
  App.IssueItemRenderer = App.View.extend({
    tagName: 'li',
    templateName: 'issue-item-renderer',
    events: {
      'click a': 'select'
    },
    select: function(e) {
      e.preventDefault();
      this.$el.trigger(App.Router.NAVIGATE, App.Router.ISSUE + '/' + this.model.get('number'));
    }
  });

  /**
   * Comment item renderer.
   */
  App.CommentItemRenderer = App.View.extend({
    tagName: 'li',
    templateName: 'comment-item-renderer'
  });

  /**
   * Main issues list view. Contains the pagination and the list of issues. Dispatches navigation
   * events that the router eventually picks up.
   */
  App.IssuesView = App.View.extend({
    templateName: 'issues-view',
    events: {
      'click #prevButton': 'prev',
      'click #nextButton': 'next'
    },
    initialize: function(options) {
      App.View.prototype.initialize.call(this, options);
      this.bindTo(this.model.issues, 'reset', this.updateNavigation, this);
      return this;
    },
    updateNavigation: function() {
      var links = this.model.issues.links;
      var getAction = function(link) {
        return links[link] ? 'removeClass' : 'addClass';
      };
      $('#prevButton')[getAction('prev')]('disabled');
      $('#nextButton')[getAction('next')]('disabled');
    },
    render: function() {
      App.View.prototype.render.call(this);
      this.views.issuesList = new App.IssuesListView({
        collection: this.model.issues
      });
      this.$('#results').html(this.views.issuesList.render().el);
      return this;
    },
    prev: function(e) {
      e.preventDefault();
      this.$el.trigger(App.Router.NAVIGATE, App.Router.ISSUES + '/' + this.model.issues.links['prev']);
    },
    next: function(e) {
      e.preventDefault();
      this.$el.trigger(App.Router.NAVIGATE, App.Router.ISSUES + '/' + this.model.issues.links['next']);
    }
  });

  /**
   * Detail view for a single issue.
   */
  App.IssueView = App.View.extend({
    templateName: 'issue-view',
    events: {
      'click #backButton': 'back'
    },
    initialize: function(options) {
      App.View.prototype.initialize.call(this, options);
      this.bindTo(this.model, 'change', this.render, this);
    },
    back: function(e) {
      e.preventDefault();
      window.history.back();
    },
    render: function() {
      App.View.prototype.render.call(this);
      this.views.commentsList = new App.CommentsListView({
        collection: this.model.comments
      });
      this.$('.comments').html(this.views.commentsList.render().el);
      return this;
    }
  });

  /**
   * Collection view for the list of issues.
   */
  App.IssuesListView = App.CollectionView.extend({
    tagName: 'ul',
    attributes: {
      'class': 'issues'
    },
    itemRenderer: App.IssueItemRenderer
  });

  /**
   * Collection view for the list of comments.
   */
  App.CommentsListView = App.CollectionView.extend({
    tagName: 'ul',
    attributes: {
      'class': 'comments'
    },
    itemRenderer: App.CommentItemRenderer
  });

  /**
   * Application router which is listening for navigation events via the DOM. I've used similar
   * concepts in Flash/Flex applications so that various components aren't tied directly together.
   * You can argue that it makes for a cleaner MVC but from a practical standpoint, it also makes
   * things much easier to unit test in my experience.
   */
  App.Router = Backbone.Router.extend({
    initialize: function(options) {
      Backbone.Router.prototype.initialize.call(this, options);
      var self = this;
      $('#content').on(App.Router.NAVIGATE, function(event, fragment) {
        self.navigate(fragment, {
          trigger: true
        });
      });
    },
    routes: {
      '': 'issues',
      'issues/:page': 'issues',
      'issue/:id': 'issue'
    },
    issues: function(page) {
      var state = new App.State({
        page: page
      });
      var issuesView = new App.IssuesView({
        model: state
      });
      $('#content').html(issuesView.render().el);
    },
    issue: function(id) {
      var issue = new App.Issue({
        id: id
      });
      issue.fetch();
      var issueView = new App.IssueView({
        model: issue
      });
      $('#content').html(issueView.render().el);
    }
  });

  App.Router.NAVIGATE = 'navigate';
  App.Router.ISSUE = 'issue';
  App.Router.ISSUES = 'issues';

  App.jsonp = true;
  App.server = 'https://api.github.com/repos/rails/rails';

  var router = new App.Router();
  Backbone.history.start();
});